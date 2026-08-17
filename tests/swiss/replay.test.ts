import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_SWISS_POINTS,
  activeStandings,
  computeRecommendedRounds,
  computeSwissFinalRanks,
  computeTiebreaks,
  formatPoints,
  isSwissComplete,
  rankSwiss,
  replaySwiss,
  type SwissMatchOutcome,
  type SwissStanding,
} from "@/lib/shared/swiss";

const teams = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ teamId: i + 1, seed: i + 1 }));

function match(
  round: number,
  team1Id: number,
  team2Id: number,
  winnerTeamId: number | null,
  overrides: Partial<SwissMatchOutcome> = {},
): SwissMatchOutcome {
  return {
    round,
    completed: true,
    team1Id,
    team2Id,
    winnerTeamId,
    loserTeamId:
      winnerTeamId === null ? null : winnerTeamId === team1Id ? team2Id : team1Id,
    isBye: false,
    ...overrides,
  };
}

function bye(round: number, teamId: number): SwissMatchOutcome {
  return {
    round,
    completed: true,
    team1Id: teamId,
    team2Id: null,
    winnerTeamId: teamId,
    loserTeamId: null,
    isBye: true,
  };
}

const replay = (
  matches: SwissMatchOutcome[],
  count = 4,
  forfeits: { teamId: number; round: number }[] = [],
) =>
  replaySwiss({
    teams: teams(count),
    matches,
    forfeits,
    points: DEFAULT_SWISS_POINTS,
  });

const byId = (standings: SwissStanding[], teamId: number): SwissStanding =>
  standings.find((s) => s.teamId === teamId)!;

describe("swiss — computeRecommendedRounds", () => {
  it.each([
    [8, 4],
    [7, 4],
    [16, 5],
    [32, 6],
    [128, 8],
  ])("%i équipes → %i rondes", (participants, expected) => {
    expect(computeRecommendedRounds(participants)).toBe(expected);
  });

  it("renvoie 0 en deçà de deux équipes (il n'y a rien à jouer)", () => {
    expect(computeRecommendedRounds(1)).toBe(0);
    expect(computeRecommendedRounds(0)).toBe(0);
  });
});

describe("swiss — formatPoints", () => {
  it("n'ajoute pas de décimale inutile", () => {
    expect(formatPoints(3)).toBe("3");
    expect(formatPoints(0)).toBe("0");
  });

  it("conserve les demi-points", () => {
    expect(formatPoints(2.5)).toBe("2.5");
  });
});

describe("swiss — replaySwiss", () => {
  it("attribue les points de victoire et de défaite", () => {
    const standings = replay([match(1, 1, 2, 1), match(1, 3, 4, 4)]);

    expect(byId(standings, 1)).toMatchObject({ points: 3, wins: 1, losses: 0 });
    expect(byId(standings, 2)).toMatchObject({ points: 0, wins: 0, losses: 1 });
    expect(byId(standings, 4)).toMatchObject({ points: 3, wins: 1, losses: 0 });
    expect(byId(standings, 3)).toMatchObject({ points: 0, wins: 0, losses: 1 });
  });

  it("traite un match terminé sans vainqueur comme un nul", () => {
    const standings = replay([match(1, 1, 2, null)]);

    expect(byId(standings, 1)).toMatchObject({ points: 1, draws: 1, wins: 0, losses: 0 });
    expect(byId(standings, 2)).toMatchObject({ points: 1, draws: 1, wins: 0, losses: 0 });
  });

  it("compte la victoire d'office séparément des victoires jouées", () => {
    const standings = replay([bye(1, 3)], 3);

    expect(byId(standings, 3)).toMatchObject({
      points: DEFAULT_SWISS_POINTS.bye,
      byes: 1,
      wins: 0,
      losses: 0,
    });
  });

  it("enregistre les adversaires dès la programmation du match, pas sa fin", () => {
    // Sans cela, la ronde suivante pourrait réapparier deux équipes en train de
    // s'affronter au moment même du calcul.
    const standings = replay([match(1, 1, 2, null, { completed: false, winnerTeamId: null })]);

    expect(byId(standings, 1).opponentIds).toEqual([2]);
    expect(byId(standings, 2).opponentIds).toEqual([1]);
    expect(byId(standings, 1).points).toBe(0);
    expect(byId(standings, 1).draws).toBe(0);
  });

  it("cumule les adversaires au fil des rondes", () => {
    const standings = replay([match(1, 1, 3, 1), match(2, 1, 2, 2), match(3, 1, 4, 1)]);

    expect(byId(standings, 1).opponentIds).toEqual([3, 2, 4]);
    expect(byId(standings, 1)).toMatchObject({ points: 6, wins: 2, losses: 1 });
  });

  it("ne compte jamais deux fois un résultat corrigé (rejeu, pas accumulation)", () => {
    // Le même appel répété sur le même historique doit donner le même état ; et
    // inverser le vainqueur doit défaire l'ancien résultat, pas s'y ajouter.
    const before = replay([match(1, 1, 2, 1)]);
    const again = replay([match(1, 1, 2, 1)]);
    const corrected = replay([match(1, 1, 2, 2)]);

    expect(again).toEqual(before);
    expect(byId(corrected, 1)).toMatchObject({ points: 0, wins: 0, losses: 1 });
    expect(byId(corrected, 2)).toMatchObject({ points: 3, wins: 1, losses: 0 });
  });

  it("marque les équipes ayant déclaré forfait sans effacer leurs points acquis", () => {
    const standings = replay([match(1, 1, 2, 1)], 4, [{ teamId: 1, round: 2 }]);

    expect(byId(standings, 1)).toMatchObject({
      status: "FORFEIT",
      forfeitRound: 2,
      points: 3,
    });
    expect(activeStandings(standings).map((s) => s.teamId)).toEqual([2, 3, 4]);
  });

  it("ramène une ronde de forfait nulle ou négative à la ronde 1", () => {
    const standings = replay([], 4, [{ teamId: 2, round: 0 }]);
    expect(byId(standings, 2).forfeitRound).toBe(1);
  });

  it("respecte un barème personnalisé", () => {
    const standings = replaySwiss({
      teams: teams(2),
      matches: [match(1, 1, 2, 1)],
      forfeits: [],
      points: { win: 1, draw: 0.5, loss: 0, bye: 1 },
    });

    expect(byId(standings, 1).points).toBe(1);
    expect(byId(standings, 2).points).toBe(0);
  });

  it("ignore les équipes inconnues d'un match (inscription supprimée)", () => {
    const standings = replay([match(1, 1, 99, 1)], 4);
    expect(byId(standings, 1)).toMatchObject({ points: 0, wins: 0, opponentIds: [] });
  });
});

describe("swiss — computeTiebreaks", () => {
  it("Buchholz = somme des points des adversaires rencontrés", () => {
    // 1 bat 2 puis 3. 2 bat 4 ; 3 perd contre 4.
    const matches = [match(1, 1, 2, 1), match(1, 3, 4, 4), match(2, 1, 3, 1), match(2, 2, 4, 2)];
    const standings = replay(matches);
    const scores = computeTiebreaks(standings, matches);

    // Adversaires de 1 : 2 (3 pts) et 3 (0 pt).
    expect(byId(standings, 2).points).toBe(3);
    expect(byId(standings, 3).points).toBe(0);
    expect(scores.get(1)!.buchholz).toBe(3);
  });

  it("Sonneborn-Berger ne compte que les adversaires battus (moitié pour un nul)", () => {
    const matches = [match(1, 1, 2, 1), match(2, 1, 3, null), match(1, 3, 4, 3)];
    const standings = replay(matches);
    const scores = computeTiebreaks(standings, matches);

    // 1 bat 2 (0 pt) → 0 ; 1 fait nul avec 3 (3 + 1 = 4 pts) → 2.
    expect(byId(standings, 3).points).toBe(4);
    expect(scores.get(1)!.sonnebornBerger).toBe(2);
  });

  it("pourcentage de victoires adverses : moyenne sur les adversaires rencontrés", () => {
    // 1 affronte 2 (1 victoire sur 2 matchs = 0.5) et 3 (0 victoire sur 1 = 0).
    const matches = [match(1, 1, 2, 1), match(1, 3, 4, 4), match(2, 1, 3, 1), match(2, 2, 4, 2)];
    const standings = replay(matches);
    const scores = computeTiebreaks(standings, matches);

    expect(scores.get(1)!.opponentMatchWinPercent).toBeCloseTo(0.25, 5);
  });

  it("équipe sans adversaire : tous les départages à zéro", () => {
    const standings = replay([], 2);
    const scores = computeTiebreaks(standings, []);

    expect(scores.get(1)).toEqual({
      buchholz: 0,
      sonnebornBerger: 0,
      opponentMatchWinPercent: 0,
    });
  });

  it("un bye ne pèse pas dans le Sonneborn-Berger (aucun adversaire battu)", () => {
    const matches = [bye(1, 1)];
    const standings = replay(matches, 3);
    expect(computeTiebreaks(standings, matches).get(1)!.sonnebornBerger).toBe(0);
  });
});

describe("swiss — rankSwiss", () => {
  it("classe d'abord aux points", () => {
    const matches = [match(1, 1, 2, 2), match(1, 3, 4, 3)];
    const ranked = rankSwiss(replay(matches), matches);

    expect(ranked.map((s) => s.teamId)).toEqual([2, 3, 1, 4]);
    expect(ranked.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
  });

  it("départage à points égaux par le Buchholz", () => {
    // 1, 2 et 3 finissent toutes à 3 points. 1 et 3 ont affronté un adversaire à
    // 3 points (Buchholz 3), 2 n'a battu que la lanterne rouge (Buchholz 0) :
    // elle passe donc derrière, malgré le même total.
    const matches = [
      match(1, 1, 3, 1), // 3 finira à 3 pts
      match(1, 2, 4, 2), // 4 finira à 0 pt
      match(2, 3, 4, 3),
    ];
    const ranked = rankSwiss(replay(matches), matches);
    const bch = new Map(ranked.map((s) => [s.teamId, s.buchholz]));

    expect(ranked.slice(0, 3).every((s) => s.points === 3)).toBe(true);
    expect([bch.get(1), bch.get(3), bch.get(2)]).toEqual([3, 3, 0]);
    // Entre 1 et 3 (Buchholz identique), Sonneborn-Berger tranche : 1 a battu
    // une équipe à 3 points, 3 une équipe à 0.
    expect(ranked.map((s) => s.teamId)).toEqual([1, 3, 2, 4]);
  });

  it("tranche par confrontation directe quand les autres départages sont muets", () => {
    // Symétrie parfaite : mêmes points, mêmes adversaires. Seul le résultat
    // direct sépare 1 et 2 — et 2 l'a emporté.
    const matches = [match(1, 1, 2, 2), match(2, 1, 2, 2)];
    const ranked = rankSwiss(replay(matches, 2), matches, ["head-to-head"]);

    expect(ranked.map((s) => s.teamId)).toEqual([2, 1]);
  });

  it("retombe sur le seed initial quand tout est à égalité", () => {
    const ranked = rankSwiss(replay([], 3), []);
    expect(ranked.map((s) => s.teamId)).toEqual([1, 2, 3]);
  });

  it("relègue les équipes ayant abandonné derrière toutes les équipes en lice", () => {
    // 1 mène au score mais a quitté le tournoi : elle passe derrière.
    const matches = [match(1, 1, 2, 1)];
    const ranked = rankSwiss(replay(matches, 3, [{ teamId: 1, round: 2 }]), matches);

    expect(ranked.map((s) => s.teamId)).toEqual([2, 3, 1]);
    expect(ranked[2].status).toBe("FORFEIT");
  });

  it("résout la confrontation directe en mini-championnat, pas par paires", () => {
    // Cycle A bat B, B bat C, C bat A, à égalité parfaite sur tout le reste.
    // Un comparateur par paires serait intransitif (A<B, B<C et C<A) et le tri
    // rendrait un ordre dépendant de l'ordre d'entrée. En bilan interne, les
    // trois sont à 0 : le seed tranche, de façon stable.
    const matches = [match(1, 1, 2, 1), match(2, 2, 3, 2), match(3, 3, 1, 3)];
    const standings = replay(matches, 3);

    expect(new Set(standings.map((s) => s.points))).toEqual(new Set([3]));

    const ranked = rankSwiss(standings, matches, ["head-to-head"]);
    expect(ranked.map((s) => s.teamId)).toEqual([1, 2, 3]);

    // Le classement ne doit pas dépendre de l'ordre d'entrée.
    const shuffled = rankSwiss([...standings].reverse(), matches, ["head-to-head"]);
    expect(shuffled.map((s) => s.teamId)).toEqual([1, 2, 3]);
  });

  it("départage un groupe d'ex æquo par le bilan interne", () => {
    // 1, 2 et 3 finissent à égalité de points ; en interne 1 a battu 2 et 3.
    const matches = [
      match(1, 1, 2, 1),
      match(2, 1, 3, 1),
      match(3, 2, 3, 2),
      match(1, 4, 5, 4),
      match(2, 4, 5, 4),
      match(3, 4, 5, 4),
    ];
    const standings = replay(matches, 5);
    const ranked = rankSwiss(standings, matches, ["head-to-head"]);
    const order = ranked.filter((s) => [1, 2, 3].includes(s.teamId)).map((s) => s.teamId);

    // 1 (2 victoires internes) devant 2 (1) devant 3 (0).
    expect(order).toEqual([1, 2, 3]);
  });

  it("ignore les matchs hors du groupe d'ex æquo dans la confrontation directe", () => {
    // 1 a battu 4, mais 4 n'est pas à égalité avec 1 et 2 : ce résultat ne doit
    // pas peser dans le départage entre 1 et 2.
    const matches = [match(1, 1, 4, 1), match(1, 2, 3, 2), match(2, 1, 2, 2)];
    const standings = replay(matches, 4);
    const ranked = rankSwiss(standings, matches, ["head-to-head"]);

    // 1 et 2 sont à 3 et 6 points : 2 devant, sans ambiguïté.
    expect(ranked[0].teamId).toBe(2);
  });

  it("n'applique que les départages configurés", () => {
    const matches = [
      match(1, 1, 3, 1),
      match(1, 2, 4, 2),
      match(2, 3, 4, 3),
    ];
    const standings = replay(matches);

    // Sans Buchholz, 1 et 2 sont à égalité stricte : le seed tranche.
    const ranked = rankSwiss(standings, matches, ["head-to-head"]);
    expect(ranked.slice(0, 2).map((s) => s.teamId)).toEqual([1, 2]);
  });
});

describe("swiss — computeSwissFinalRanks / isSwissComplete", () => {
  it("le classement final reprend le classement courant", () => {
    const matches = [match(1, 1, 2, 2)];
    const ranked = rankSwiss(replay(matches, 2), matches);
    const ranks = computeSwissFinalRanks(ranked);

    expect(ranks.get(2)).toBe(1);
    expect(ranks.get(1)).toBe(2);
  });

  it("le tournoi est clos une fois toutes les rondes prévues jouées", () => {
    expect(isSwissComplete(4, 5)).toBe(false);
    expect(isSwissComplete(5, 5)).toBe(true);
    expect(isSwissComplete(6, 5)).toBe(true);
  });

  it("sans nombre de rondes défini, rien ne clôt le tournoi", () => {
    expect(isSwissComplete(3, 0)).toBe(false);
  });
});

describe("swiss — tournoi complet à 8 équipes", () => {
  it("produit un classement cohérent sur 3 rondes", () => {
    const matches: SwissMatchOutcome[] = [
      // Ronde 1 : moitié haute contre moitié basse, les têtes de série gagnent.
      match(1, 1, 5, 1),
      match(1, 2, 6, 2),
      match(1, 3, 7, 7),
      match(1, 4, 8, 4),
      // Ronde 2 : gagnantes entre elles, perdantes entre elles.
      match(2, 1, 2, 1),
      match(2, 4, 7, 4),
      match(2, 5, 6, 5),
      match(2, 3, 8, 3),
      // Ronde 3.
      match(3, 1, 4, 1),
      match(3, 2, 7, 2),
      match(3, 3, 5, 3),
      match(3, 6, 8, 6),
    ];

    const standings = replay(matches, 8);
    const ranked = rankSwiss(standings, matches);

    // Chaque équipe a joué exactement trois matchs.
    for (const s of standings) {
      expect(s.wins + s.draws + s.losses).toBe(3);
      expect(s.opponentIds).toHaveLength(3);
    }

    // 1 est invaincue : elle est championne.
    expect(byId(standings, 1)).toMatchObject({ wins: 3, losses: 0, points: 9 });
    expect(ranked[0].teamId).toBe(1);

    // Le total des points distribués correspond au barème (3 par match joué).
    const total = standings.reduce((sum, s) => sum + s.points, 0);
    expect(total).toBe(matches.length * DEFAULT_SWISS_POINTS.win);

    // Les rangs sont une permutation stricte de 1..8.
    expect(ranked.map((s) => s.rank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("aucune équipe ne rencontre deux fois la même adversaire", () => {
    const matches: SwissMatchOutcome[] = [
      match(1, 1, 5, 1),
      match(1, 2, 6, 2),
      match(1, 3, 7, 7),
      match(1, 4, 8, 4),
      match(2, 1, 2, 1),
      match(2, 4, 7, 4),
      match(2, 5, 6, 5),
      match(2, 3, 8, 3),
    ];

    for (const s of replay(matches, 8)) {
      expect(new Set(s.opponentIds).size).toBe(s.opponentIds.length);
    }
  });
});
