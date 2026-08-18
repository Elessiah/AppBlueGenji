import { describe, expect, it } from "@jest/globals";
import {
  assignRanks,
  buildPlayoffPairings,
  compareEndurance,
  DEFAULT_ENDURANCE_CONFIG,
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

describe("resolveEnduranceConfig", () => {
  it("retombe sur 9 / ±1 / 8 quand rien n'est renseigné", () => {
    expect(resolveEnduranceConfig()).toEqual(DEFAULT_ENDURANCE_CONFIG);
    expect(resolveEnduranceConfig(null)).toEqual(DEFAULT_ENDURANCE_CONFIG);
  });

  it("accepte un barème personnalisé", () => {
    expect(resolveEnduranceConfig({ startPoints: 12, winDelta: 2, lossDelta: 3, playoffSize: 4 })).toEqual({
      startPoints: 12,
      winDelta: 2,
      lossDelta: 3,
      playoffSize: 4,
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
