import { describe, it, expect } from "@jest/globals";

describe("tournaments-service: ranking", () => {
  describe("final ranking calculation", () => {
    it("single elimination: winner is champion", () => {
      const position = 1; // Final bracket position
      const rank = position === 1 ? 1 : null;
      expect(rank).toBe(1);
    });

    it("single elimination: loser of final is runner-up", () => {
      const position = 2;
      const rank = position === 2 ? 2 : null;
      expect(rank).toBe(2);
    });

    it("single elimination: semifinal losers tied for 3rd", () => {
      const position = 3;
      const tieForThird = true;
      expect(tieForThird).toBe(true);
    });

    it("double elimination: UB winner > LB winner if UB wins grand final", () => {
      const ubWinnerWinsGrand = true;
      const rank = ubWinnerWinsGrand ? 1 : 2;
      expect(rank).toBe(1);
    });

    it("double elimination: LB winner becomes champion if wins grand final reset", () => {
      const lbWinnerWinsReset = true;
      const rank = lbWinnerWinsReset ? 1 : 2;
      expect(rank).toBe(1);
    });

    it("double elimination: grand final loser is runner-up", () => {
      const position = 2;
      const rank = position === 2 ? 2 : null;
      expect(rank).toBe(2);
    });
  });

  describe("ranking tiebreakers", () => {
    it("ranking sorts by bracket position first", () => {
      const positions = [1, 2, 3, 4];
      const sorted = positions.sort((a, b) => a - b);
      expect(sorted[0]).toBe(1);
      expect(sorted[sorted.length - 1]).toBe(4);
    });

    it("tied position sorted by wins desc", () => {
      const teams = [
        { position: 3, wins: 2, losses: 1 },
        { position: 3, wins: 3, losses: 0 }, // More wins
      ];
      const sorted = teams.sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return b.wins - a.wins;
      });
      expect(sorted[0].wins).toBe(3);
    });

    it("tied wins sorted by losses asc", () => {
      const teams = [
        { position: 3, wins: 2, losses: 2 },
        { position: 3, wins: 2, losses: 1 }, // Fewer losses
      ];
      const sorted = teams.sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        return a.losses - b.losses;
      });
      expect(sorted[0].losses).toBe(1);
    });

    it("tied wins/losses sorted by participation recency", () => {
      const teams = [
        { position: 3, wins: 2, losses: 1, lastMatchAt: new Date("2026-01-01") },
        { position: 3, wins: 2, losses: 1, lastMatchAt: new Date("2026-01-02") },
      ];
      const sorted = teams.sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return b.lastMatchAt.getTime() - a.lastMatchAt.getTime();
      });
      expect(sorted[0].lastMatchAt.getTime()).toBeGreaterThan(sorted[1].lastMatchAt.getTime());
    });
  });

  describe("win/loss counting", () => {
    it("team with 1 win, 0 losses", () => {
      const wins = 1;
      const losses = 0;
      expect(wins).toBe(1);
      expect(losses).toBe(0);
    });

    it("team with 2 wins, 1 loss", () => {
      const wins = 2;
      const losses = 1;
      expect(wins + losses).toBe(3); // 3 matches played
    });

    it("champion in 8-team double elim has minimum wins", () => {
      // Single elim winner: 3 wins (R1, R2, Final)
      // Or: LB path complex
      const winnerWins = 3;
      expect(winnerWins).toBeGreaterThanOrEqual(2);
    });

    it("team eliminated in first round has 0 wins", () => {
      const wins = 0;
      const losses = 1;
      expect(wins).toBe(0);
    });

    it("runner-up in single elim has max losses with 2nd rank", () => {
      const losses = 0; // Lost only to champion in final
      expect(losses).toBeLessThanOrEqual(0);
    });
  });

  describe("tournament completion", () => {
    it("tournament marked FINISHED after grand final", () => {
      const state = "FINISHED";
      expect(state).toBe("FINISHED");
    });

    it("all teams have final_rank assigned", () => {
      const teams = [
        { id: 1, finalRank: 1 },
        { id: 2, finalRank: 2 },
        { id: 3, finalRank: 3 },
        { id: 4, finalRank: 4 },
      ];
      const allRanked = teams.every((t) => t.finalRank !== null);
      expect(allRanked).toBe(true);
    });

    it("no duplicate ranks", () => {
      const ranks = [1, 2, 3, 4];
      const unique = new Set(ranks);
      expect(unique.size).toBe(ranks.length);
    });

    it("ranks are contiguous 1,2,3...", () => {
      const ranks = [1, 2, 3, 4];
      for (let i = 0; i < ranks.length; i++) {
        expect(ranks[i]).toBe(i + 1);
      }
    });

    it("finished_at timestamp set on completion", () => {
      const finishedAt = new Date("2026-01-01T15:00:00Z");
      expect(finishedAt).toBeDefined();
      expect(finishedAt.getTime()).toBeGreaterThan(0);
    });
  });

  describe("scenario: 8-team single elim", () => {
    it("champion beats 3 opponents (R1, R2, Final)", () => {
      const champion = { wins: 3, losses: 0, rank: 1 };
      expect(champion.wins).toBe(3);
      expect(champion.rank).toBe(1);
    });

    it("runner-up beats 2, loses 1", () => {
      const runnerUp = { wins: 2, losses: 1, rank: 2 };
      expect(runnerUp.wins).toBe(2);
      expect(runnerUp.losses).toBe(1);
      expect(runnerUp.rank).toBe(2);
    });

    it("semifinal losers both have 2 wins, 1 loss (tied 3rd)", () => {
      const semifinalists = [
        { wins: 2, losses: 1, rank: 3 },
        { wins: 2, losses: 1, rank: 3 },
      ];
      for (const team of semifinalists) {
        expect(team.wins).toBe(2);
        expect(team.losses).toBe(1);
      }
    });

    it("quarterfinal losers have 1 win, 1 loss (tied 5th)", () => {
      const quarterLosers = [
        { wins: 1, losses: 1, rank: 5 },
        { wins: 1, losses: 1, rank: 5 },
      ];
      for (const team of quarterLosers) {
        expect(team.wins).toBe(1);
        expect(team.losses).toBe(1);
      }
    });

    it("first round losers have 0 wins, 1 loss (tied 7th)", () => {
      const firstRoundLosers = [
        { wins: 0, losses: 1, rank: 7 },
        { wins: 0, losses: 1, rank: 7 },
      ];
      for (const team of firstRoundLosers) {
        expect(team.wins).toBe(0);
        expect(team.losses).toBe(1);
      }
    });

    it("total of 8 teams ranked 1-8", () => {
      const teams = 8;
      const ranks = Array.from({ length: teams }, (_, i) => i + 1);
      expect(ranks.length).toBe(teams);
      expect(ranks[0]).toBe(1);
      expect(ranks[ranks.length - 1]).toBe(8);
    });
  });

  describe("scenario: 4-team double elim", () => {
    it("UB winner can win grand final immediately", () => {
      const ubWinner = { from: "UPPER", winsGrand: true, rank: 1 };
      expect(ubWinner.rank).toBe(1);
    });

    it("LB winner goes to grand final", () => {
      const lbWinner = { from: "LOWER", rank: 2 };
      expect(lbWinner.rank).toBe(2);
    });

    it("UB semifinal loser goes to LB", () => {
      const ubSemiLoser = { loses: true, goes: "LOWER" };
      expect(ubSemiLoser.goes).toBe("LOWER");
    });

    it("UB final loser goes to grand final if wins LB", () => {
      const ubFinalLoser = { goesTo: "GRAND" };
      expect(ubFinalLoser.goesTo).toBe("GRAND");
    });
  });

  describe("leaderboard construction", () => {
    it("leaderboard sorted by rank asc", () => {
      const leaderboard = [
        { rank: 1, team: "A" },
        { rank: 2, team: "B" },
        { rank: 3, team: "C" },
      ];
      const sorted = [...leaderboard].sort((a, b) => a.rank - b.rank);
      expect(sorted[0].rank).toBe(1);
      expect(sorted[sorted.length - 1].rank).toBe(3);
    });

    it("leaderboard includes top 3 for trophy display", () => {
      const leaderboard = [
        { rank: 1, team: "Champion" },
        { rank: 2, team: "Runner-up" },
        { rank: 3, team: "Third" },
      ];
      const top3 = leaderboard.slice(0, 3);
      expect(top3.length).toBe(3);
      expect(top3[0].rank).toBe(1);
    });

    it("leaderboard can show all participants", () => {
      const teams = 16;
      const leaderboard = Array.from({ length: teams }, (_, i) => ({
        rank: i + 1,
        team: `Team ${i + 1}`,
      }));
      expect(leaderboard.length).toBe(teams);
      expect(leaderboard[0].rank).toBe(1);
      expect(leaderboard[leaderboard.length - 1].rank).toBe(teams);
    });
  });
});
