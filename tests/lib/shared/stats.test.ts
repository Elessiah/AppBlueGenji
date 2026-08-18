import { describe, expect, it } from "@jest/globals";
import {
  ACTIVITY_MONTHS,
  FORM_LENGTH,
  computeDeepStats,
  emptyDeepStats,
  formatDiff,
  formatRate,
  formatStreak,
  monthKey,
  type StatsMatch,
  type StatsTournament,
} from "@/lib/shared/stats";
import { RANKING_POINTS_PER_LOSS, RANKING_POINTS_PER_WIN } from "@/lib/shared/ranking";

const NOW = new Date("2026-06-15T12:00:00Z");

function match(overrides: Partial<StatsMatch> = {}): StatsMatch {
  return {
    matchId: 1,
    tournamentId: 10,
    tournamentName: "Test - Coupe",
    game: "OW2",
    format: "SINGLE",
    bracket: "UPPER",
    playedAt: "2026-06-01T18:00:00Z",
    opponentTeamId: 99,
    opponentName: "Adversaire",
    won: true,
    scoreFor: 2,
    scoreAgainst: 1,
    forfeit: "NONE",
    ...overrides,
  };
}

function tournament(overrides: Partial<StatsTournament> = {}): StatsTournament {
  return {
    tournamentId: 10,
    tournamentName: "Test - Coupe",
    state: "FINISHED",
    format: "SINGLE",
    game: "OW2",
    finalRank: 4,
    playedAt: "2026-06-02T18:00:00Z",
    ...overrides,
  };
}

/** Suite de matchs datés de jours consécutifs, du plus ancien au plus récent. */
function series(results: boolean[], overrides: Partial<StatsMatch> = {}): StatsMatch[] {
  return results.map((won, index) =>
    match({
      matchId: index + 1,
      playedAt: `2026-06-${String(index + 1).padStart(2, "0")}T18:00:00Z`,
      won,
      scoreFor: won ? 2 : 0,
      scoreAgainst: won ? 0 : 2,
      ...overrides,
    }),
  );
}

describe("computeDeepStats", () => {
  describe("entité sans historique", () => {
    it("renvoie un bilan vide plutôt que des zéros trompeurs", () => {
      const stats = computeDeepStats([], [], NOW);

      expect(stats.matchesPlayed).toBe(0);
      expect(stats.winRate).toBeNull();
      expect(stats.mapWinRate).toBeNull();
      expect(stats.bestRank).toBeNull();
      expect(stats.averageRank).toBeNull();
      expect(stats.currentStreak).toEqual({ kind: "NONE", length: 0 });
      expect(stats.form).toEqual([]);
      expect(stats.favouriteOpponent).toBeNull();
      expect(stats.nemesis).toBeNull();
      expect(stats.firstMatchAt).toBeNull();
    });

    it("expose quand même la fenêtre d'activité complète", () => {
      const stats = computeDeepStats([], [], NOW);
      expect(stats.activity).toHaveLength(ACTIVITY_MONTHS);
      expect(stats.activity.every((point) => point.played === 0)).toBe(true);
    });

    it("emptyDeepStats correspond au calcul sur des listes vides", () => {
      expect(computeDeepStats([], [], NOW)).toEqual(emptyDeepStats(NOW));
    });
  });

  describe("bilan des matchs", () => {
    it("compte victoires, défaites et ratio", () => {
      const stats = computeDeepStats(series([true, true, false, true]), [], NOW);

      expect(stats.matchesPlayed).toBe(4);
      expect(stats.matchesWon).toBe(3);
      expect(stats.matchesLost).toBe(1);
      expect(stats.winRate).toBe(0.75);
    });

    it("cumule les maps et leur différentiel", () => {
      const stats = computeDeepStats(
        [
          match({ matchId: 1, scoreFor: 3, scoreAgainst: 1, won: true }),
          match({ matchId: 2, scoreFor: 0, scoreAgainst: 2, won: false }),
        ],
        [],
        NOW,
      );

      expect(stats.mapsWon).toBe(3);
      expect(stats.mapsLost).toBe(3);
      expect(stats.mapDiff).toBe(0);
      expect(stats.mapWinRate).toBe(0.5);
    });

    it("applique le barème de classement partagé", () => {
      const stats = computeDeepStats(series([true, true, false]), [], NOW);
      expect(stats.rankingPoints).toBe(2 * RANKING_POINTS_PER_WIN + RANKING_POINTS_PER_LOSS);
    });

    it("distingue les forfaits donnés des forfaits reçus", () => {
      const stats = computeDeepStats(
        [
          match({ matchId: 1, won: false, forfeit: "GIVEN" }),
          match({ matchId: 2, won: true, forfeit: "RECEIVED" }),
          match({ matchId: 3, won: true, forfeit: "NONE" }),
        ],
        [],
        NOW,
      );

      expect(stats.forfeitsGiven).toBe(1);
      expect(stats.forfeitsReceived).toBe(1);
    });
  });

  describe("séries et forme", () => {
    it("suit la série en cours de victoires", () => {
      const stats = computeDeepStats(series([false, true, true, true]), [], NOW);
      expect(stats.currentStreak).toEqual({ kind: "WIN", length: 3 });
    });

    it("suit la série en cours de défaites", () => {
      const stats = computeDeepStats(series([true, false, false]), [], NOW);
      expect(stats.currentStreak).toEqual({ kind: "LOSS", length: 2 });
    });

    it("retient la meilleure et la pire série de l'historique", () => {
      const stats = computeDeepStats(
        series([true, true, true, false, false, true]),
        [],
        NOW,
      );

      expect(stats.bestWinStreak).toBe(3);
      expect(stats.worstLossStreak).toBe(2);
      expect(stats.currentStreak).toEqual({ kind: "WIN", length: 1 });
    });

    it("donne la forme du plus récent au plus ancien, limitée à FORM_LENGTH", () => {
      const stats = computeDeepStats(
        series([true, false, true, true, false, true, false]),
        [],
        NOW,
      );

      expect(stats.form).toHaveLength(FORM_LENGTH);
      expect(stats.form).toEqual(["L", "W", "L", "W", "W"]);
    });

    it("ordonne les matchs reçus en désordre avant tout calcul", () => {
      const ordered = series([true, true, false]);
      const shuffled = [ordered[2], ordered[0], ordered[1]];

      expect(computeDeepStats(shuffled, [], NOW)).toEqual(computeDeepStats(ordered, [], NOW));
    });

    it("départage deux matchs de même horodatage par leur identifiant", () => {
      const sameInstant = [
        match({ matchId: 2, playedAt: "2026-06-01T18:00:00Z", won: false }),
        match({ matchId: 1, playedAt: "2026-06-01T18:00:00Z", won: true }),
      ];

      // Le match 2 étant le dernier, la série en cours est une défaite.
      expect(computeDeepStats(sameInstant, [], NOW).currentStreak).toEqual({
        kind: "LOSS",
        length: 1,
      });
    });
  });

  describe("répartitions", () => {
    it("sépare les jeux et trie par volume décroissant", () => {
      const stats = computeDeepStats(
        [
          match({ matchId: 1, game: "MR", won: true }),
          match({ matchId: 2, game: "OW2", won: true }),
          match({ matchId: 3, game: "OW2", won: false }),
          match({ matchId: 4, game: "OW2", won: true }),
        ],
        [],
        NOW,
      );

      expect(stats.byGame.map((split) => split.key)).toEqual(["OW2", "MR"]);
      expect(stats.byGame[0]).toMatchObject({ played: 3, won: 2, lost: 1 });
      expect(stats.byGame[0].label).toBe("Overwatch");
      expect(stats.byGame[1].winRate).toBe(1);
    });

    it("sépare les formats de tournoi", () => {
      const stats = computeDeepStats(
        [
          match({ matchId: 1, format: "SWISS", won: true }),
          match({ matchId: 2, format: "BG_SURVIE", won: false }),
        ],
        [],
        NOW,
      );

      expect(stats.byFormat.map((split) => split.label).sort()).toEqual([
        "BlueGenji Survie",
        "Ronde suisse",
      ]);
    });
  });

  describe("adversaires", () => {
    it("désigne l'adversaire le plus battu et la bête noire", () => {
      const stats = computeDeepStats(
        [
          match({ matchId: 1, opponentTeamId: 1, opponentName: "Alpha", won: true }),
          match({ matchId: 2, opponentTeamId: 1, opponentName: "Alpha", won: true }),
          match({ matchId: 3, opponentTeamId: 2, opponentName: "Beta", won: false }),
          match({ matchId: 4, opponentTeamId: 2, opponentName: "Beta", won: false }),
          match({ matchId: 5, opponentTeamId: 2, opponentName: "Beta", won: true }),
        ],
        [],
        NOW,
      );

      expect(stats.favouriteOpponent).toMatchObject({ teamId: 1, won: 2, played: 2 });
      expect(stats.nemesis).toMatchObject({ teamId: 2, lost: 2, played: 3 });
    });

    it("n'invente pas d'adversaire favori sans la moindre victoire", () => {
      const stats = computeDeepStats(
        [match({ matchId: 1, opponentTeamId: 1, opponentName: "Alpha", won: false })],
        [],
        NOW,
      );

      expect(stats.favouriteOpponent).toBeNull();
      expect(stats.nemesis).toMatchObject({ teamId: 1, lost: 1 });
    });

    it("départage deux adversaires à égalité par le nom", () => {
      const stats = computeDeepStats(
        [
          match({ matchId: 1, opponentTeamId: 2, opponentName: "Zeta", won: true }),
          match({ matchId: 2, opponentTeamId: 1, opponentName: "Alpha", won: true }),
        ],
        [],
        NOW,
      );

      expect(stats.favouriteOpponent?.teamName).toBe("Alpha");
    });

    it("ignore les matchs sans adversaire identifié", () => {
      const stats = computeDeepStats(
        [match({ matchId: 1, opponentTeamId: null, opponentName: null, won: true })],
        [],
        NOW,
      );

      expect(stats.matchesWon).toBe(1);
      expect(stats.favouriteOpponent).toBeNull();
    });
  });

  describe("activité mensuelle", () => {
    it("range chaque match dans son mois", () => {
      const stats = computeDeepStats(
        [
          match({ matchId: 1, playedAt: "2026-06-02T10:00:00Z", won: true }),
          match({ matchId: 2, playedAt: "2026-06-20T10:00:00Z", won: false }),
          match({ matchId: 3, playedAt: "2026-05-04T10:00:00Z", won: true }),
        ],
        [],
        NOW,
      );

      const june = stats.activity.find((point) => point.month === "2026-06");
      const may = stats.activity.find((point) => point.month === "2026-05");
      expect(june).toEqual({ month: "2026-06", played: 2, won: 1 });
      expect(may).toEqual({ month: "2026-05", played: 1, won: 1 });
    });

    it("ignore les matchs antérieurs à la fenêtre sans les perdre du bilan", () => {
      const stats = computeDeepStats(
        [match({ matchId: 1, playedAt: "2019-01-01T10:00:00Z", won: true })],
        [],
        NOW,
      );

      expect(stats.matchesPlayed).toBe(1);
      expect(stats.activity.every((point) => point.played === 0)).toBe(true);
    });

    it("couvre les douze mois glissants, du plus ancien au plus récent", () => {
      const stats = computeDeepStats([], [], NOW);
      expect(stats.activity[0].month).toBe("2025-07");
      expect(stats.activity[ACTIVITY_MONTHS - 1].month).toBe("2026-06");
    });

    it("retient le premier et le dernier match joués", () => {
      const stats = computeDeepStats(series([true, false, true]), [], NOW);
      expect(stats.firstMatchAt).toBe("2026-06-01T18:00:00Z");
      expect(stats.lastMatchAt).toBe("2026-06-03T18:00:00Z");
    });
  });

  describe("palmarès", () => {
    it("compte titres, podiums, meilleur rang et rang moyen", () => {
      const stats = computeDeepStats(
        [],
        [
          tournament({ tournamentId: 1, finalRank: 1 }),
          tournament({ tournamentId: 2, finalRank: 3 }),
          tournament({ tournamentId: 3, finalRank: 8 }),
        ],
        NOW,
      );

      expect(stats.tournamentsPlayed).toBe(3);
      expect(stats.tournamentsWon).toBe(1);
      expect(stats.podiums).toBe(2);
      expect(stats.bestRank).toBe(1);
      expect(stats.averageRank).toBe(4);
    });

    it("compte les tournois en cours sans fausser rang moyen ni podiums", () => {
      const stats = computeDeepStats(
        [],
        [
          tournament({ tournamentId: 1, state: "RUNNING", finalRank: null }),
          tournament({ tournamentId: 2, finalRank: 2 }),
        ],
        NOW,
      );

      expect(stats.tournamentsPlayed).toBe(2);
      expect(stats.podiums).toBe(1);
      expect(stats.averageRank).toBe(2);
    });

    it("ne compte pas comme joué un tournoi pas encore lancé", () => {
      const stats = computeDeepStats(
        [],
        [
          tournament({ tournamentId: 1, state: "REGISTRATION", finalRank: null }),
          tournament({ tournamentId: 2, state: "UPCOMING", finalRank: null }),
          tournament({ tournamentId: 3, state: "FINISHED", finalRank: 2 }),
        ],
        NOW,
      );

      expect(stats.tournamentsPlayed).toBe(1);
      expect(stats.tournamentsUpcoming).toBe(2);
    });

    it("compte un tournoi en cours comme joué", () => {
      const stats = computeDeepStats(
        [],
        [tournament({ state: "RUNNING", finalRank: null })],
        NOW,
      );

      expect(stats.tournamentsPlayed).toBe(1);
      expect(stats.tournamentsUpcoming).toBe(0);
    });

    it("laisse rang moyen et meilleur rang vides sans classement final", () => {
      const stats = computeDeepStats(
        [],
        [tournament({ state: "RUNNING", finalRank: null })],
        NOW,
      );

      expect(stats.bestRank).toBeNull();
      expect(stats.averageRank).toBeNull();
    });

    it("arrondit le rang moyen à deux décimales", () => {
      const stats = computeDeepStats(
        [],
        [
          tournament({ tournamentId: 1, finalRank: 1 }),
          tournament({ tournamentId: 2, finalRank: 2 }),
          tournament({ tournamentId: 3, finalRank: 2 }),
        ],
        NOW,
      );

      expect(stats.averageRank).toBe(1.67);
    });
  });
});

describe("monthKey", () => {
  it("formate en YYYY-MM sur le fuseau universel", () => {
    expect(monthKey("2026-03-09T23:30:00Z")).toBe("2026-03");
    expect(monthKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });

  it("renvoie une chaîne vide pour une date invalide", () => {
    expect(monthKey("pas-une-date")).toBe("");
  });
});

describe("formatage", () => {
  it("formate un ratio en pourcentage, tiret cadratin si inconnu", () => {
    expect(formatRate(0.6667)).toBe("67 %");
    expect(formatRate(0)).toBe("0 %");
    expect(formatRate(null)).toBe("—");
  });

  it("formate un différentiel signé", () => {
    expect(formatDiff(7)).toBe("+7");
    expect(formatDiff(0)).toBe("0");
    expect(formatDiff(-3)).toBe("-3");
  });

  it("accorde le libellé de série", () => {
    expect(formatStreak({ kind: "WIN", length: 1 })).toBe("1 victoire d'affilée");
    expect(formatStreak({ kind: "WIN", length: 4 })).toBe("4 victoires d'affilée");
    expect(formatStreak({ kind: "LOSS", length: 2 })).toBe("2 défaites d'affilée");
    expect(formatStreak({ kind: "NONE", length: 0 })).toBe("Aucune série");
  });
});
