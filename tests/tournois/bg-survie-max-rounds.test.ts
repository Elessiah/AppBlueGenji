import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_ENDURANCE_CONFIG,
  enduranceEliminationCut,
  enduranceRoundSwing,
  replayEnduranceDetailed,
  resolveEnduranceConfig,
  roundLimitReached,
  type EnduranceConfig,
  type EnduranceMatchOutcome,
  type EnduranceStanding,
} from "@/lib/shared/bg-survie";

const FT3 = { type: "FT", value: 3 } as const;

function config(overrides: Partial<EnduranceConfig> = {}): EnduranceConfig {
  return { ...DEFAULT_ENDURANCE_CONFIG, ...overrides };
}

function standing(teamId: number, points: number, previousRank = teamId): EnduranceStanding {
  return {
    teamId,
    seed: teamId,
    points,
    wins: 0,
    losses: 0,
    status: "ACTIVE",
    eliminatedRound: null,
    rank: teamId,
    previousRank,
  };
}

function teams(count: number) {
  return Array.from({ length: count }, (_, index) => ({ teamId: index + 1, seed: index + 1 }));
}

function winMaps(
  round: number,
  winnerTeamId: number,
  loserTeamId: number,
  winnerMaps: number,
  loserMaps: number,
): EnduranceMatchOutcome {
  return { round, completed: true, winnerTeamId, loserTeamId, winnerMaps, loserMaps };
}

/** Statuts du rejeu, par équipe — la seule chose que la coupe change. */
function statuses(standings: EnduranceStanding[]): Record<number, string> {
  return Object.fromEntries(standings.map((s) => [s.teamId, s.status]));
}

function pointsOf(standings: EnduranceStanding[]): Record<number, number> {
  return Object.fromEntries(standings.map((s) => [s.teamId, s.points]));
}

describe("resolveEnduranceConfig — plafond de manches", () => {
  it("laisse la phase à durée libre quand rien n'est renseigné", () => {
    expect(resolveEnduranceConfig().maxRounds).toBeNull();
    expect(resolveEnduranceConfig({ playoffSize: 8 }).maxRounds).toBeNull();
  });

  it.each([[0], [-3], [Number.NaN]])(
    "refuse un plafond absurde (%p) et retombe sur aucun",
    (value) => {
      expect(resolveEnduranceConfig({ maxRounds: value }).maxRounds).toBeNull();
    },
  );

  it("tronque un plafond fractionnaire", () => {
    expect(resolveEnduranceConfig({ maxRounds: 4.9 }).maxRounds).toBe(4);
  });
});

describe("roundLimitReached", () => {
  it("ne s'oppose à rien sans plafond", () => {
    expect(roundLimitReached(config(), 99)).toBe(false);
  });

  it.each([
    [2, false],
    [3, true],
    [4, true],
  ])("plafond 3, %i manches closes → %s", (completedRounds, expected) => {
    expect(roundLimitReached(config({ maxRounds: 3 }), completedRounds)).toBe(expected);
  });
});

describe("enduranceRoundSwing", () => {
  it("chiffre le meilleur gain et la pire perte d'une manche depuis le format", () => {
    expect(enduranceRoundSwing(config(), FT3)).toEqual({ gain: 3, loss: 3 });
    expect(enduranceRoundSwing(config({ winDelta: 2, lossDelta: 5 }), FT3)).toEqual({
      gain: 6,
      loss: 15,
    });
  });

  // Sans format, une manche n'a pas de plafond de maps : plus rien n'est
  // arithmétiquement acquis, donc rien ne peut être conclu d'avance.
  it("ne borne rien en saisie libre", () => {
    expect(enduranceRoundSwing(config(), null)).toBeNull();
  });
});

describe("enduranceEliminationCut — dernière manche", () => {
  const cfg = config({ playoffSize: 2, maxRounds: 3 });

  it("trace le trait sous la cible une fois la dernière manche jouée", () => {
    const standings = [standing(1, 12), standing(2, 11), standing(3, 8), standing(4, 8)];
    expect(enduranceEliminationCut(standings, cfg, 0, FT3)).toEqual([3, 4]);
  });

  it("ne coupe rien quand l'effectif est déjà sous la cible", () => {
    expect(enduranceEliminationCut([standing(1, 12)], cfg, 0, FT3)).toEqual([]);
  });

  // Le trait de fin ne demande aucun format : il ne prédit rien, il constate.
  it("s'applique même en saisie libre", () => {
    const standings = [standing(1, 12), standing(2, 11), standing(3, 8)];
    expect(enduranceEliminationCut(standings, cfg, 0, null)).toEqual([3]);
  });
});

describe("enduranceEliminationCut — élimination mathématique", () => {
  const cfg = config({ playoffSize: 2, maxRounds: 5 });

  it("écarte une équipe que deux autres devancent quoi qu'il arrive", () => {
    // Une manche restante en FT3 : ±3 au maximum. Les têtes (plancher 17)
    // finissent devant les dernières (plafond 4) dans tous les cas de figure.
    const standings = [standing(1, 20), standing(2, 20), standing(3, 1), standing(4, 1)];
    expect(enduranceEliminationCut(standings, cfg, 1, FT3).sort()).toEqual([3, 4]);
  });

  it("ne conclut rien tant qu'un retour reste arithmétiquement possible", () => {
    // Deux manches restantes : la dernière (plafond 1 + 6 = 7) rejoint encore
    // les têtes (plancher 12 − 6 = 6).
    const standings = [standing(1, 12), standing(2, 12), standing(3, 12), standing(4, 1)];
    expect(enduranceEliminationCut(standings, cfg, 2, FT3)).toEqual([]);
  });

  it("ne conclut jamais rien en saisie libre", () => {
    const standings = [standing(1, 99), standing(2, 99), standing(3, 1), standing(4, 1)];
    expect(enduranceEliminationCut(standings, cfg, 1, null)).toEqual([]);
  });

  // Une équipe à égalité avec le plafond de la condamnée n'est pas « acquise » :
  // le départage se ferait au classement précédent, pas à l'arithmétique.
  it("exige un écart strict", () => {
    const standings = [standing(1, 7), standing(2, 7), standing(3, 1), standing(4, 1)];
    expect(enduranceEliminationCut(standings, cfg, 1, FT3)).toEqual([]);
  });

  it("laisse jouer une équipe condamnée plutôt que de créer un effectif impair", () => {
    // Trois têtes hors d'atteinte, deux condamnées : la coupe laisserait trois
    // équipes en course, donc une au repos forcé à la manche suivante.
    const standings = [
      standing(1, 20),
      standing(2, 20),
      standing(3, 20),
      standing(4, 1),
      standing(5, 1),
    ];
    expect(enduranceEliminationCut(standings, cfg, 1, FT3)).toEqual([]);
  });

  it("coupe dès que l'effectif restant retombe pair", () => {
    const standings = [
      standing(1, 20),
      standing(2, 20),
      standing(3, 20),
      standing(4, 20),
      standing(5, 1),
      standing(6, 1),
    ];
    expect(enduranceEliminationCut(standings, cfg, 1, FT3).sort()).toEqual([5, 6]);
  });

  // La parité ne protège que des équipes à qui il reste une manche à jouer :
  // ramenée pile à la cible, la phase s'arrête et personne ne chôme.
  it("coupe jusqu'à la cible même en nombre impair", () => {
    const cible3 = config({ playoffSize: 3, maxRounds: 5 });
    const standings = [
      standing(1, 20),
      standing(2, 20),
      standing(3, 20),
      standing(4, 1),
      standing(5, 1),
    ];
    expect(enduranceEliminationCut(standings, cible3, 1, FT3).sort()).toEqual([4, 5]);
  });

  it("ignore les équipes déjà sorties", () => {
    const standings = [
      standing(1, 20),
      standing(2, 20),
      { ...standing(3, 0), status: "ELIMINATED" as const, eliminatedRound: 2 },
      standing(4, 1),
      standing(5, 1),
    ];
    // Seules les quatre actives comptent : deux devancent les dernières, et la
    // coupe laisse un effectif pair.
    expect(enduranceEliminationCut(standings, cfg, 1, FT3).sort()).toEqual([4, 5]);
  });
});

describe("replayEndurance — plafond de manches", () => {
  /** Manche 1 serrée : personne ne s'écroule, tout se joue au classement. */
  const closeRound: EnduranceMatchOutcome[] = [winMaps(1, 1, 2, 3, 2), winMaps(1, 3, 4, 3, 2)];

  it("qualifie les meilleures et écarte le reste à la dernière manche", () => {
    const { standings } = replayEnduranceDetailed({
      teams: teams(4),
      matches: closeRound,
      forfeits: [],
      config: config({ playoffSize: 2, maxRounds: 1 }),
      lastRound: 1,
      matchFormat: FT3,
    });

    expect(statuses(standings)).toEqual({
      1: "ACTIVE",
      2: "OUT_OF_CONTENTION",
      3: "ACTIVE",
      4: "OUT_OF_CONTENTION",
    });
    // Le capital n'est pas vidé : c'est l'horizon qui manque, pas les points —
    // et c'est précisément ce qu'« ELIMINATED » ne saurait pas dire.
    expect(pointsOf(standings)[2]).toBe(8);
    expect(pointsOf(standings)[4]).toBe(8);
  });

  it("ne coupe rien sans plafond", () => {
    const { standings } = replayEnduranceDetailed({
      teams: teams(4),
      matches: closeRound,
      forfeits: [],
      config: config({ playoffSize: 2 }),
      lastRound: 1,
      matchFormat: FT3,
    });

    expect(statuses(standings)).toEqual({ 1: "ACTIVE", 2: "ACTIVE", 3: "ACTIVE", 4: "ACTIVE" });
  });

  // Une manche entamée n'est pas un classement : une équipe qui n'a pas encore
  // joué la sienne y serait jugée sur un capital amputé de ses gains à venir.
  it("attend que la manche soit close pour couper", () => {
    const { standings } = replayEnduranceDetailed({
      teams: teams(4),
      matches: [
        closeRound[0],
        { round: 1, completed: false, winnerTeamId: null, loserTeamId: null },
      ],
      forfeits: [],
      config: config({ playoffSize: 2, maxRounds: 1 }),
      lastRound: 1,
      matchFormat: FT3,
    });

    expect(statuses(standings)).toEqual({ 1: "ACTIVE", 2: "ACTIVE", 3: "ACTIVE", 4: "ACTIVE" });
  });

  /**
   * Deux manches franches sur trois : l'écart devient tel que les deux
   * dernières ne peuvent plus rejoindre les têtes à la manche 3.
   */
  const runawayRounds: EnduranceMatchOutcome[] = [
    winMaps(1, 1, 4, 3, 0),
    winMaps(1, 2, 3, 3, 1),
    winMaps(2, 1, 4, 3, 0),
    winMaps(2, 2, 3, 3, 0),
  ];

  it("écarte en cours de route une équipe hors d'atteinte", () => {
    const { standings, history } = replayEnduranceDetailed({
      teams: teams(4),
      matches: runawayRounds,
      forfeits: [],
      config: config({ playoffSize: 2, maxRounds: 3 }),
      lastRound: 2,
      matchFormat: FT3,
    });

    expect(statuses(standings)).toEqual({
      1: "ACTIVE",
      2: "ACTIVE",
      3: "OUT_OF_CONTENTION",
      4: "OUT_OF_CONTENTION",
    });
    expect(standings.find((s) => s.teamId === 3)?.eliminatedRound).toBe(2);

    // La manche de la sortie montre encore le capital : c'en est le résultat.
    expect(history.get(3)).toEqual([
      { round: 1, kind: "POINTS", points: 7 },
      { round: 2, kind: "POINTS", points: 4 },
    ]);
  });

  it("laisse les manches suivantes vides pour une équipe écartée", () => {
    const { history } = replayEnduranceDetailed({
      teams: teams(4),
      matches: runawayRounds,
      forfeits: [],
      config: config({ playoffSize: 2, maxRounds: 3 }),
      lastRound: 3,
      matchFormat: FT3,
    });

    expect(history.get(3)?.[2]).toEqual({ round: 3, kind: "OUT", points: null });
  });

  // Le rejeu est la seule vérité : retirer le plafond défait la coupe, comme
  // une correction de score défait une élimination.
  it("reste dérivé — la coupe se défait quand le plafond disparaît", () => {
    const { standings } = replayEnduranceDetailed({
      teams: teams(4),
      matches: runawayRounds,
      forfeits: [],
      config: config({ playoffSize: 2 }),
      lastRound: 2,
      matchFormat: FT3,
    });

    expect(statuses(standings)).toEqual({ 1: "ACTIVE", 2: "ACTIVE", 3: "ACTIVE", 4: "ACTIVE" });
  });
});
