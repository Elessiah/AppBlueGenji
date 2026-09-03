import { describe, expect, it } from "@jest/globals";
import { dependentMatches, isScoreEditLocked, type MatchScoreState } from "@/lib/shared/match-lock";
import {
  assignRanks,
  buildPlayoffPairings,
  compareEndurance,
  DEFAULT_ENDURANCE_CONFIG,
  enduranceMatchMaps,
  forfeitMapCount,
  planEnduranceRound,
  PLAYOFF_QUARTER_PAIRINGS,
  qualificationComplete,
  replayEndurance,
  resolveEnduranceConfig,
  selectQualifiedTeamIds,
  type EnduranceMatchOutcome,
  type EnduranceStanding,
} from "@/lib/shared/bg-survie";

const CONFIG = DEFAULT_ENDURANCE_CONFIG;

function standing(overrides: Partial<EnduranceStanding> & { teamId: number }): EnduranceStanding {
  return {
    seed: overrides.teamId,
    points: CONFIG.startPoints,
    wins: 0,
    losses: 0,
    status: "ACTIVE",
    eliminatedRound: null,
    rank: overrides.teamId,
    previousRank: overrides.teamId,
    ...overrides,
  };
}

/** N équipes seedées 1..N, dans l'ordre fixé par l'arbitre. */
function teams(count: number) {
  return Array.from({ length: count }, (_, index) => ({ teamId: index + 1, seed: index + 1 }));
}

function win(round: number, winnerTeamId: number, loserTeamId: number): EnduranceMatchOutcome {
  return { round, completed: true, winnerTeamId, loserTeamId };
}

/** Victoire avec son score de maps, seule forme qui fasse bouger le barème. */
function winMaps(
  round: number,
  winnerTeamId: number,
  loserTeamId: number,
  winnerMaps: number,
  loserMaps: number,
): EnduranceMatchOutcome {
  return { round, completed: true, winnerTeamId, loserTeamId, winnerMaps, loserMaps };
}

const FT3 = { type: "FT", value: 3 } as const;
const BO5 = { type: "BO", value: 5 } as const;
const BO3 = { type: "BO", value: 3 } as const;

describe("resolveEnduranceConfig", () => {
  it("retombe sur 9 / ±1 / 8 quand rien n'est renseigné", () => {
    expect(resolveEnduranceConfig()).toEqual(DEFAULT_ENDURANCE_CONFIG);
    expect(resolveEnduranceConfig(null)).toEqual(DEFAULT_ENDURANCE_CONFIG);
  });

  it("accepte un barème personnalisé", () => {
    expect(
      resolveEnduranceConfig({
        startPoints: 12,
        winDelta: 2,
        lossDelta: 3,
        playoffSize: 4,
        maxRounds: 6,
      }),
    ).toEqual({
      startPoints: 12,
      winDelta: 2,
      lossDelta: 3,
      playoffSize: 4,
      maxRounds: 6,
    });
  });

  it.each([
    [{ startPoints: 0 }],
    [{ startPoints: -5 }],
    [{ winDelta: 0 }],
    [{ lossDelta: -1 }],
    [{ playoffSize: 1 }],
    [{ startPoints: Number.NaN }],
  ])("ignore une valeur absurde (%p)", (partial) => {
    expect(resolveEnduranceConfig(partial)).toEqual(DEFAULT_ENDURANCE_CONFIG);
  });
});

describe("forfeitMapCount", () => {
  it("vaut l'objectif du format : FT3 et BO5 valent trois maps", () => {
    expect(forfeitMapCount(FT3)).toBe(3);
    expect(forfeitMapCount(BO5)).toBe(3);
    expect(forfeitMapCount(BO3)).toBe(2);
    expect(forfeitMapCount({ type: "FT", value: 1 })).toBe(1);
  });

  it("retombe sur une map en saisie libre", () => {
    expect(forfeitMapCount(null)).toBe(1);
    expect(forfeitMapCount(undefined)).toBe(1);
  });
});

describe("enduranceMatchMaps", () => {
  const played = (winnerMaps: unknown, loserMaps: unknown): EnduranceMatchOutcome => ({
    round: 1,
    completed: true,
    winnerTeamId: 1,
    loserTeamId: 2,
    winnerMaps: winnerMaps as number | null,
    loserMaps: loserMaps as number | null,
  });

  it("rend les scores saisis tels quels", () => {
    expect(enduranceMatchMaps(played(3, 1), FT3)).toEqual({ winnerMaps: 3, loserMaps: 1 });
    expect(enduranceMatchMaps(played(3, 0), FT3)).toEqual({ winnerMaps: 3, loserMaps: 0 });
  });

  it("ignore les scores d'un forfait au profit du format", () => {
    const forfeit = { ...played(9, 9), isForfeit: true };
    expect(enduranceMatchMaps(forfeit, FT3)).toEqual({ winnerMaps: 3, loserMaps: 0 });
  });

  it.each([
    ["scores absents", played(null, null)],
    ["score du vainqueur absent", played(null, 2)],
    ["match tranché sans score (0-0)", played(0, 0)],
    ["score négatif", played(3, -1)],
    ["score non numérique", played("x", "y")],
  ])("retombe sur un 1-0 : %s", (_label, outcome) => {
    expect(enduranceMatchMaps(outcome, FT3)).toEqual({ winnerMaps: 1, loserMaps: 0 });
  });

  it("tronque un score décimal plutôt que de le propager", () => {
    expect(enduranceMatchMaps(played(3.7, 1.2), FT3)).toEqual({ winnerMaps: 3, loserMaps: 1 });
  });
});

describe("compareEndurance", () => {
  it("classe d'abord par endurance décroissante", () => {
    const a = standing({ teamId: 1, points: 7, previousRank: 5 });
    const b = standing({ teamId: 2, points: 9, previousRank: 1 });
    expect([a, b].sort(compareEndurance).map((s) => s.teamId)).toEqual([2, 1]);
  });

  it("départage à égalité par le classement PRÉCÉDENT, pas par le seed", () => {
    // Seed 1 pour l'équipe 1, mais elle est passée derrière au tour d'avant.
    const a = standing({ teamId: 1, seed: 1, points: 9, previousRank: 2 });
    const b = standing({ teamId: 2, seed: 2, points: 9, previousRank: 1 });
    expect([a, b].sort(compareEndurance).map((s) => s.teamId)).toEqual([2, 1]);
  });
});

describe("planEnduranceRound", () => {
  it("apparie par couples adjacents du classement", () => {
    const standings = [1, 2, 3, 4].map((teamId) => standing({ teamId, previousRank: teamId }));
    expect(planEnduranceRound(standings)).toEqual([
      { teamAId: 1, teamBId: 2 },
      { teamAId: 3, teamBId: 4 },
    ]);
  });

  it("met la mieux classée du couple à gauche", () => {
    const standings = [
      standing({ teamId: 7, points: 5, previousRank: 2 }),
      standing({ teamId: 3, points: 9, previousRank: 1 }),
    ];
    expect(planEnduranceRound(standings)[0]).toEqual({ teamAId: 3, teamBId: 7 });
  });

  it("laisse la dernière du classement au repos sur un effectif impair", () => {
    const standings = [1, 2, 3].map((teamId) => standing({ teamId, previousRank: teamId }));
    const pairings = planEnduranceRound(standings);
    expect(pairings).toEqual([
      { teamAId: 1, teamBId: 2 },
      { teamAId: 3, teamBId: null },
    ]);
  });

  it("ignore les équipes sorties", () => {
    const standings = [
      standing({ teamId: 1, previousRank: 1 }),
      standing({ teamId: 2, status: "ELIMINATED", eliminatedRound: 1, previousRank: 2 }),
      standing({ teamId: 3, previousRank: 3 }),
    ];
    expect(planEnduranceRound(standings)).toEqual([{ teamAId: 1, teamBId: 3 }]);
  });
});

describe("replayEndurance — endurance et éliminations", () => {
  it("part du capital configuré pour tout le monde", () => {
    const standings = replayEndurance({
      teams: teams(4),
      matches: [],
      forfeits: [],
      config: CONFIG,
      lastRound: 0,
    });
    expect(standings.every((s) => s.points === 9 && s.status === "ACTIVE")).toBe(true);
  });

  it("ajoute un point au vainqueur et en retire un au perdant", () => {
    const standings = replayEndurance({
      teams: teams(2),
      matches: [win(1, 1, 2)],
      forfeits: [],
      config: CONFIG,
      lastRound: 1,
    });
    const byId = new Map(standings.map((s) => [s.teamId, s]));
    expect(byId.get(1)).toMatchObject({ points: 10, wins: 1, losses: 0 });
    expect(byId.get(2)).toMatchObject({ points: 8, wins: 0, losses: 1 });
  });

  it("élimine immédiatement une équipe tombée à 0", () => {
    const matches = Array.from({ length: 9 }, (_, index) => win(index + 1, 1, 2));
    const standings = replayEndurance({
      teams: teams(2),
      matches,
      forfeits: [],
      config: CONFIG,
      lastRound: 9,
    });
    const loser = standings.find((s) => s.teamId === 2)!;
    expect(loser).toMatchObject({ points: 0, status: "ELIMINATED", eliminatedRound: 9 });
  });

  it("ignore les matchs d'une équipe déjà éliminée (score corrigé après coup)", () => {
    const matches = [
      ...Array.from({ length: 9 }, (_, index) => win(index + 1, 1, 2)),
      // Manche 10 : l'équipe 2 est déjà sortie, sa victoire ne la ressuscite pas.
      win(10, 2, 1),
    ];
    const standings = replayEndurance({
      teams: teams(2),
      matches,
      forfeits: [],
      config: CONFIG,
      lastRound: 10,
    });
    const byId = new Map(standings.map((s) => [s.teamId, s]));
    expect(byId.get(2)).toMatchObject({ status: "ELIMINATED", points: 0, wins: 0 });
    // L'équipe 1 ne perd pas non plus de point face à une éliminée.
    expect(byId.get(1)!.points).toBe(18);
  });

  it("est idempotent : rejouer deux fois le même historique donne le même état", () => {
    const input = {
      teams: teams(4),
      matches: [win(1, 1, 2), win(1, 3, 4), win(2, 1, 3), win(2, 2, 4)],
      forfeits: [],
      config: CONFIG,
      lastRound: 2,
    };
    expect(replayEndurance(input)).toEqual(replayEndurance(input));
  });

  it("annule une élimination si le score qui l'avait causée est corrigé", () => {
    const losing = Array.from({ length: 9 }, (_, index) => win(index + 1, 1, 2));
    const eliminated = replayEndurance({
      teams: teams(2),
      matches: losing,
      forfeits: [],
      config: CONFIG,
      lastRound: 9,
    });
    expect(eliminated.find((s) => s.teamId === 2)!.status).toBe("ELIMINATED");

    // La dernière manche est corrigée : c'est l'équipe 2 qui l'emporte.
    const corrected = [...losing.slice(0, 8), win(9, 2, 1)];
    const after = replayEndurance({
      teams: teams(2),
      matches: corrected,
      forfeits: [],
      config: CONFIG,
      lastRound: 9,
    });
    expect(after.find((s) => s.teamId === 2)).toMatchObject({ status: "ACTIVE", points: 2 });
  });

  it("compte un forfait comme le score plein du format (FT3 → 3-0)", () => {
    // Aucune map n'a été jouée, mais le règlement compte le forfait comme un
    // 3-0 : trois points au vainqueur, trois de moins au perdant.
    const standings = replayEndurance({
      teams: teams(2),
      matches: [{ round: 1, completed: true, winnerTeamId: 1, loserTeamId: 2, isForfeit: true }],
      forfeits: [],
      config: CONFIG,
      lastRound: 1,
      matchFormat: FT3,
    });
    const byId = new Map(standings.map((s) => [s.teamId, s]));
    expect(byId.get(1)).toMatchObject({ points: 12, wins: 1, losses: 0 });
    expect(byId.get(2)).toMatchObject({ points: 6, wins: 0, losses: 1, status: "ACTIVE" });
  });

  it("chiffre le forfait sur le format du tournoi, pas sur les colonnes de score", () => {
    // L'arbitrage laisse les scores à NULL sur un forfait : seul le format dit
    // combien de maps il vaut.
    const forfeit = {
      round: 1,
      completed: true,
      winnerTeamId: 1,
      loserTeamId: 2,
      winnerMaps: null,
      loserMaps: null,
      isForfeit: true,
    };
    const pointsOf = (matchFormat: Parameters<typeof forfeitMapCount>[0]) =>
      replayEndurance({
        teams: teams(2),
        matches: [forfeit],
        forfeits: [],
        config: CONFIG,
        lastRound: 1,
        matchFormat,
      }).find((s) => s.teamId === 2)!.points;

    expect(pointsOf(BO5)).toBe(6);
    expect(pointsOf(BO3)).toBe(7);
    // Score libre : le forfait retombe sur une seule map.
    expect(pointsOf(null)).toBe(8);
  });

  it("élimine sur-le-champ une équipe que le forfait vide de son capital", () => {
    const standings = replayEndurance({
      teams: teams(2),
      matches: [{ round: 1, completed: true, winnerTeamId: 1, loserTeamId: 2, isForfeit: true }],
      forfeits: [],
      config: resolveEnduranceConfig({ startPoints: 3 }),
      lastRound: 1,
      matchFormat: FT3,
    });
    expect(standings.find((s) => s.teamId === 2)).toMatchObject({
      points: 0,
      status: "ELIMINATED",
      eliminatedRound: 1,
    });
  });

  it("écrit FORFAIT plutôt qu'ÉLIMINÉE quand l'abandon a lui-même vidé le capital", () => {
    // Abandon en manche 1 : le match est clos 3-0, ce qui met l'équipe à 0 dans
    // la même manche. C'est la décision humaine qui doit rester au classement.
    const standings = replayEndurance({
      teams: teams(2),
      matches: [{ round: 1, completed: true, winnerTeamId: 1, loserTeamId: 2, isForfeit: true }],
      forfeits: [{ teamId: 2, round: 1 }],
      config: resolveEnduranceConfig({ startPoints: 3 }),
      lastRound: 1,
      matchFormat: FT3,
    });
    const byId = new Map(standings.map((s) => [s.teamId, s]));
    expect(byId.get(2)).toMatchObject({ status: "FORFEIT", points: 0, eliminatedRound: 1 });
    // L'adversaire encaisse bien ses trois points au passage.
    expect(byId.get(1)!.points).toBe(6);
  });

  it("compte le barème map par map, pas match par match", () => {
    const standings = replayEndurance({
      teams: teams(4),
      matches: [winMaps(1, 1, 2, 3, 0), winMaps(1, 3, 4, 3, 2)],
      forfeits: [],
      config: CONFIG,
      lastRound: 1,
      matchFormat: FT3,
    });
    const byId = new Map(standings.map((s) => [s.teamId, s]));
    // 3-0 : trois maps gagnées d'un côté, trois perdues de l'autre.
    expect(byId.get(1)).toMatchObject({ points: 12, wins: 1, losses: 0 });
    expect(byId.get(2)).toMatchObject({ points: 6, wins: 0, losses: 1 });
    // 3-2 : le vainqueur ne gagne qu'un point net, le perdant n'en perd qu'un.
    expect(byId.get(3)!.points).toBe(10);
    expect(byId.get(4)!.points).toBe(8);
  });

  it("retombe sur un 1-0 quand le match n'a pas de score (saisie libre)", () => {
    const standings = replayEndurance({
      teams: teams(2),
      matches: [win(1, 1, 2)],
      forfeits: [],
      config: CONFIG,
      lastRound: 1,
      matchFormat: null,
    });
    const byId = new Map(standings.map((s) => [s.teamId, s]));
    expect(byId.get(1)!.points).toBe(10);
    expect(byId.get(2)!.points).toBe(8);
  });

  it("sort aussi le vainqueur d'un match qui l'a vidé de son capital", () => {
    // Barème où une map perdue coûte plus qu'une map gagnée ne rapporte : un
    // 3-2 peut faire tomber son vainqueur à 0.
    const standings = replayEndurance({
      teams: teams(2),
      matches: [winMaps(1, 1, 2, 3, 2)],
      forfeits: [],
      config: resolveEnduranceConfig({ startPoints: 3, winDelta: 1, lossDelta: 3 }),
      lastRound: 1,
      matchFormat: FT3,
    });
    const byId = new Map(standings.map((s) => [s.teamId, s]));
    expect(byId.get(1)).toMatchObject({ points: 0, status: "ELIMINATED", wins: 1 });
    expect(byId.get(2)).toMatchObject({ points: 0, status: "ELIMINATED", losses: 1 });
  });

  it("reste idempotent avec des scores de maps", () => {
    const input = {
      teams: teams(4),
      matches: [winMaps(1, 1, 2, 3, 1), winMaps(1, 3, 4, 3, 0)],
      forfeits: [],
      config: CONFIG,
      lastRound: 1,
      matchFormat: FT3,
    };
    expect(replayEndurance(input)).toEqual(replayEndurance(input));
  });

  it("prend en compte un abandon comme une sortie", () => {
    const standings = replayEndurance({
      teams: teams(4),
      matches: [],
      forfeits: [{ teamId: 3, round: 2 }],
      config: CONFIG,
      lastRound: 2,
    });
    expect(standings.find((s) => s.teamId === 3)).toMatchObject({
      status: "FORFEIT",
      eliminatedRound: 2,
      points: 0,
    });
  });

  it("respecte un barème personnalisé", () => {
    const config = resolveEnduranceConfig({ startPoints: 4, winDelta: 2, lossDelta: 4, playoffSize: 8 });
    const standings = replayEndurance({
      teams: teams(2),
      matches: [win(1, 1, 2)],
      forfeits: [],
      config,
      lastRound: 1,
    });
    const byId = new Map(standings.map((s) => [s.teamId, s]));
    expect(byId.get(1)!.points).toBe(6);
    // 4 - 4 = 0 → éliminée dès la première défaite.
    expect(byId.get(2)).toMatchObject({ points: 0, status: "ELIMINATED", eliminatedRound: 1 });
  });

  it("conserve l'ordre du classement précédent entre équipes à égalité", () => {
    // Manche 1 : 2 bat 1 → 2 passe devant. Manche 2 : 1 bat 2 → égalité à 9,
    // l'ordre de la manche précédente (2 puis 1) doit être conservé.
    const standings = replayEndurance({
      teams: teams(2),
      matches: [win(1, 2, 1), win(2, 1, 2)],
      forfeits: [],
      config: CONFIG,
      lastRound: 2,
    });
    expect(standings.map((s) => s.teamId)).toEqual([2, 1]);
    expect(standings.every((s) => s.points === 9)).toBe(true);
  });
});

describe("assignRanks", () => {
  it("place les actives devant, puis les sorties de la plus tardive à la plus précoce", () => {
    const ranked = assignRanks([
      standing({ teamId: 1, points: 9, previousRank: 1 }),
      standing({ teamId: 2, status: "ELIMINATED", eliminatedRound: 1, points: 0, previousRank: 2 }),
      standing({ teamId: 3, status: "ELIMINATED", eliminatedRound: 4, points: 0, previousRank: 3 }),
      standing({ teamId: 4, points: 11, previousRank: 4 }),
    ]);
    expect(ranked.map((s) => s.teamId)).toEqual([4, 1, 3, 2]);
    expect(ranked.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe("phase éliminatoire", () => {
  it("suit le tableau imposé 8v4, 6v2, 1v5, 3v7", () => {
    expect(PLAYOFF_QUARTER_PAIRINGS).toEqual([
      [8, 4],
      [6, 2],
      [1, 5],
      [3, 7],
    ]);
  });

  it("convertit les rangs en équipes, le haut du tableau à gauche", () => {
    // qualified[0] = 1er, … qualified[7] = 8e.
    const qualified = [101, 102, 103, 104, 105, 106, 107, 108];
    expect(buildPlayoffPairings(qualified)).toEqual([
      { teamAId: 108, teamBId: 104 },
      { teamAId: 106, teamBId: 102 },
      { teamAId: 101, teamBId: 105 },
      { teamAId: 103, teamBId: 107 },
    ]);
  });

  it("refuse un plateau qui n'a pas huit équipes", () => {
    expect(() => buildPlayoffPairings([1, 2, 3, 4])).toThrow("INVALID_PLAYOFF_FIELD");
    expect(() => buildPlayoffPairings(Array.from({ length: 9 }, (_, i) => i))).toThrow(
      "INVALID_PLAYOFF_FIELD",
    );
  });

  it("sélectionne les huit premiers du classement", () => {
    const standings = Array.from({ length: 12 }, (_, index) =>
      standing({ teamId: index + 1, points: 20 - index, previousRank: index + 1 }),
    );
    expect(selectQualifiedTeamIds(standings, CONFIG)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  // Le barème par map sort plusieurs équipes dans la même manche : le plateau
  // peut passer sous huit d'un coup. `assignRanks` rangeant les sorties après
  // les actives, une tranche non filtrée complèterait l'arbre avec elles.
  it("ne complète jamais le plateau avec des équipes sorties", () => {
    const standings = [
      ...Array.from({ length: 5 }, (_, index) =>
        standing({ teamId: index + 1, points: 9 - index, previousRank: index + 1 }),
      ),
      standing({ teamId: 6, points: 0, status: "ELIMINATED", eliminatedRound: 4 }),
      standing({ teamId: 7, points: 0, status: "FORFEIT", eliminatedRound: 4 }),
      standing({ teamId: 8, points: 0, status: "ELIMINATED", eliminatedRound: 3 }),
      standing({ teamId: 9, points: 0, status: "ELIMINATED", eliminatedRound: 3 }),
    ];

    expect(selectQualifiedTeamIds(standings, CONFIG)).toEqual([1, 2, 3, 4, 5]);
  });

  it("ne qualifie personne quand la dernière manche a tout vidé", () => {
    const standings = Array.from({ length: 8 }, (_, index) =>
      standing({ teamId: index + 1, points: 0, status: "ELIMINATED", eliminatedRound: 5 }),
    );

    expect(selectQualifiedTeamIds(standings, CONFIG)).toEqual([]);
  });
});

describe("qualificationComplete", () => {
  it.each([
    [9, false],
    [8, true],
    [3, true],
  ])("%i équipes actives → %s", (activeCount, expected) => {
    expect(qualificationComplete(activeCount, CONFIG)).toBe(expected);
  });
});

describe("verrouillage des scores en BlueGenji Survie", () => {
  /** Deux manches successives, sans lien de bracket (le mode n'en pose aucun). */
  function match(overrides: Partial<MatchScoreState> & { id: number; roundNumber: number }): MatchScoreState {
    return {
      team1Id: 1,
      team2Id: 2,
      team1Score: null,
      team2Score: null,
      winnerTeamId: null,
      forfeitTeamId: null,
      hasPendingReport: false,
      nextWinnerMatchId: null,
      nextLoserMatchId: null,
      ...overrides,
    };
  }

  it("considère toute manche ultérieure comme dépendante", () => {
    const first = match({ id: 1, roundNumber: 1, winnerTeamId: 1 });
    const second = match({ id: 2, roundNumber: 2 });

    expect(dependentMatches(first, [first, second], "BG_SURVIE").map((m) => m.id)).toEqual([2]);
  });

  it("verrouille un score dès que la manche suivante porte une saisie", () => {
    const first = match({ id: 1, roundNumber: 1, winnerTeamId: 1 });
    const played = match({ id: 2, roundNumber: 2, team1Score: 2, team2Score: 1, winnerTeamId: 1 });

    expect(isScoreEditLocked(first, [first, played], "BG_SURVIE")).toBe(true);
  });

  it("verrouille aussi depuis un tour de play-offs", () => {
    const qualification = match({ id: 1, roundNumber: 3, winnerTeamId: 1 });
    const playoff = match({ id: 2, roundNumber: 1000, winnerTeamId: 2, team1Score: 3, team2Score: 0 });

    expect(isScoreEditLocked(qualification, [qualification, playoff], "BG_SURVIE")).toBe(true);
  });

  it("laisse modifiable tant que la manche suivante est vierge", () => {
    const first = match({ id: 1, roundNumber: 1, winnerTeamId: 1 });
    const pending = match({ id: 2, roundNumber: 2 });

    expect(isScoreEditLocked(first, [first, pending], "BG_SURVIE")).toBe(false);
  });
});
