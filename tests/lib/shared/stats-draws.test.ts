import { describe, expect, it } from "@jest/globals";
import {
  computeDeepStats,
  formatStreak,
  type StatsMatch,
  type StatsOutcome,
} from "@/lib/shared/stats";

const NOW = new Date("2026-06-15T12:00:00Z");

function match(
  matchId: number,
  outcome: StatsOutcome,
  overrides: Partial<StatsMatch> = {},
): StatsMatch {
  return {
    matchId,
    tournamentId: 10,
    tournamentName: "Test - Coupe",
    game: "OW2",
    format: "BG_SURVIE",
    bracket: "UPPER",
    playedAt: `2026-06-${String(matchId).padStart(2, "0")}T18:00:00Z`,
    opponentTeamId: 99,
    opponentName: "Adversaire",
    outcome,
    scoreFor: 2,
    scoreAgainst: 2,
    forfeit: "NONE",
    ...overrides,
  };
}

describe("computeDeepStats — matchs nuls", () => {
  it("les compte à part, sans les ranger en défaites", () => {
    const stats = computeDeepStats([match(1, "WIN"), match(2, "DRAW"), match(3, "LOSS")], [], NOW);

    expect(stats.matchesPlayed).toBe(3);
    expect(stats.matchesWon).toBe(1);
    expect(stats.matchesLost).toBe(1);
    expect(stats.matchesDrawn).toBe(1);
  });

  it("garde les nuls au dénominateur du ratio de victoires", () => {
    // Les retirer ferait remonter le ratio d'une équipe qui n'a pourtant pas
    // gagné : un nul est un match joué.
    const stats = computeDeepStats([match(1, "WIN"), match(2, "DRAW")], [], NOW);

    expect(stats.winRate).toBe(0.5);
  });

  it("rompt les deux séries", () => {
    const stats = computeDeepStats(
      [match(1, "WIN"), match(2, "WIN"), match(3, "DRAW"), match(4, "WIN")],
      [],
      NOW,
    );

    // Sans cette règle, la fiche annoncerait « 3 victoires d'affilée » à une
    // équipe qui vient de concéder un 2-2.
    expect(stats.currentStreak).toEqual({ kind: "WIN", length: 1 });
    expect(stats.bestWinStreak).toBe(2);
  });

  it("annonce une série interrompue quand le dernier match est nul", () => {
    const stats = computeDeepStats([match(1, "WIN"), match(2, "WIN"), match(3, "DRAW")], [], NOW);

    expect(stats.currentStreak).toEqual({ kind: "DRAW", length: 1 });
    expect(formatStreak(stats.currentStreak)).toBe("Série interrompue par un nul");
  });

  it("n'allonge pas la pire série de défaites", () => {
    const stats = computeDeepStats(
      [match(1, "LOSS"), match(2, "DRAW"), match(3, "LOSS")],
      [],
      NOW,
    );

    expect(stats.worstLossStreak).toBe(1);
  });

  it("porte « D » dans la forme, distinct de la défaite", () => {
    const stats = computeDeepStats([match(1, "WIN"), match(2, "DRAW"), match(3, "LOSS")], [], NOW);

    // Le plus récent en tête. La pastille affichée est « N » (voir StatsPanel) :
    // « D » y désigne déjà la défaite.
    expect(stats.form).toEqual(["L", "D", "W"]);
  });

  it("compte le nul dans le volume d'une répartition, sans l'ajouter aux victoires", () => {
    const stats = computeDeepStats(
      [match(1, "WIN"), match(2, "DRAW"), match(3, "LOSS")],
      [],
      NOW,
    );

    expect(stats.byGame[0]).toMatchObject({ played: 3, won: 1, lost: 1 });
    expect(stats.byFormat[0]).toMatchObject({ played: 3, won: 1, lost: 1 });
  });

  it("compte le nul dans les confrontations d'un adversaire, sans en faire un titre", () => {
    const stats = computeDeepStats(
      [
        match(1, "WIN", { opponentTeamId: 1, opponentName: "Alpha" }),
        match(2, "DRAW", { opponentTeamId: 1, opponentName: "Alpha" }),
      ],
      [],
      NOW,
    );

    expect(stats.favouriteOpponent).toMatchObject({ teamId: 1, played: 2, won: 1, lost: 0 });
  });

  it("n'invente pas d'adversaire favori quand tout est nul", () => {
    const stats = computeDeepStats(
      [
        match(1, "DRAW", { opponentTeamId: 1, opponentName: "Alpha" }),
        match(2, "DRAW", { opponentTeamId: 2, opponentName: "Beta" }),
      ],
      [],
      NOW,
    );

    expect(stats.favouriteOpponent).toBeNull();
    expect(stats.nemesis).toBeNull();
  });

  it("compte le nul dans l'activité du mois sans le porter aux victoires", () => {
    const stats = computeDeepStats([match(1, "DRAW"), match(2, "WIN")], [], NOW);
    const june = stats.activity.find((point) => point.month === "2026-06");

    expect(june).toEqual({ month: "2026-06", played: 2, won: 1 });
  });

  it("compte les maps d'un nul des deux côtés", () => {
    // Le bilan de maps est indépendant de l'issue : un 2-2 apporte deux maps
    // gagnées et deux perdues.
    const stats = computeDeepStats([match(1, "DRAW", { scoreFor: 2, scoreAgainst: 2 })], [], NOW);

    expect(stats.mapsWon).toBe(2);
    expect(stats.mapsLost).toBe(2);
    expect(stats.mapDiff).toBe(0);
  });
});
