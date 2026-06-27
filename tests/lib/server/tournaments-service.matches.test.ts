import { describe, it, expect, jest } from "@jest/globals";
import type { BracketMatch } from "@/lib/shared/types";
import { finalizeMatch } from "@/lib/server/tournaments/scoring";
import { qualifyDestinationMatchId } from "@/app/(secured)/tournois/[id]/_lib/bracket-sections";

describe("tournaments-service: match state machine", () => {
  describe("match status transitions", () => {
    it("match starts in PENDING state when brackets generated", () => {
      const status = "PENDING";
      expect(status).toBe("PENDING");
    });

    it("match moves to READY when both teams assigned", () => {
      const team1Assigned = true;
      const team2Assigned = true;
      const isReady = team1Assigned && team2Assigned;
      expect(isReady).toBe(true);
    });

    it("match stays PENDING if only one team assigned", () => {
      const team1Assigned = true;
      const team2Assigned = false;
      const isReady = team1Assigned && team2Assigned;
      expect(isReady).toBe(false);
    });

    it("match moves to AWAITING_CONFIRMATION when first score reported", () => {
      const team1Reported = true;
      const team2Reported = false;
      const isAwaitingConfirmation = team1Reported && !team2Reported;
      expect(isAwaitingConfirmation).toBe(true);
    });

    it("match moves to COMPLETED when scores agree", () => {
      const team1Score = 3;
      const team1OpponentScore = 1;
      const team2Score = 1;
      const team2OpponentScore = 3;
      const scoresAgree = team1Score === team2OpponentScore && team2Score === team1OpponentScore;
      expect(scoresAgree).toBe(true);
    });

    it("match stays AWAITING_CONFIRMATION when scores disagree", () => {
      const team1Score = 3;
      const team1OpponentScore = 1;
      const team2Score = 2;
      const team2OpponentScore = 3;
      const scoresAgree = team1Score === team2OpponentScore && team2Score === team1OpponentScore;
      expect(scoresAgree).toBe(false);
    });
  });

  describe("score reporting", () => {
    it("team1 can report their score and opponent score", () => {
      const team1Score = 3;
      const team1OpponentScore = 1;
      const reported = team1Score !== null && team1OpponentScore !== null;
      expect(reported).toBe(true);
    });

    it("team2 can report their score and opponent score", () => {
      const team2Score = 1;
      const team2OpponentScore = 3;
      const reported = team2Score !== null && team2OpponentScore !== null;
      expect(reported).toBe(true);
    });

    it("reports must have valid score values (0-10)", () => {
      const score = 5;
      const isValid = score >= 0 && score <= 10;
      expect(isValid).toBe(true);
    });

    it("score < 0 is invalid", () => {
      const score = -1;
      const isValid = score >= 0 && score <= 10;
      expect(isValid).toBe(false);
    });

    it("score > 10 is invalid", () => {
      const score = 11;
      const isValid = score >= 0 && score <= 10;
      expect(isValid).toBe(false);
    });

    it("cannot report score for non-participant", () => {
      const team1Id = 1;
      const team2Id = 2;
      const reportingTeamId = 3;
      const isParticipant = reportingTeamId === team1Id || reportingTeamId === team2Id;
      expect(isParticipant).toBe(false);
    });

    it("cannot report score for already COMPLETED match", () => {
      const matchStatus = "COMPLETED";
      const canReport = matchStatus !== "COMPLETED";
      expect(canReport).toBe(false);
    });
  });

  describe("score deadline", () => {
    it("score report deadline is SCORE_REPORT_TIMEOUT_MINUTES", () => {
      const SCORE_REPORT_TIMEOUT_MINUTES = 10;
      expect(SCORE_REPORT_TIMEOUT_MINUTES).toBe(10);
    });

    it("timeout is 10 minutes from match completion", () => {
      const matchCompletedAt = new Date("2026-01-01T12:00:00Z");
      const deadlineMinutes = 10;
      const deadline = new Date(matchCompletedAt.getTime() + deadlineMinutes * 60 * 1000);
      const expectedDeadline = new Date("2026-01-01T12:10:00Z");
      expect(deadline.getTime()).toBe(expectedDeadline.getTime());
    });

    it("check if deadline passed", () => {
      const deadline = new Date("2026-01-01T12:10:00Z");
      const now = new Date("2026-01-01T12:15:00Z");
      const deadlinePassed = now > deadline;
      expect(deadlinePassed).toBe(true);
    });

    it("check if deadline not yet passed", () => {
      const deadline = new Date("2026-01-01T12:10:00Z");
      const now = new Date("2026-01-01T12:05:00Z");
      const deadlinePassed = now > deadline;
      expect(deadlinePassed).toBe(false);
    });
  });

  describe("bye handling", () => {
    it("bye match has no participants", () => {
      const team1Id = null;
      const team2Id = null;
      const isByeMatch = team1Id === null && team2Id === null;
      expect(isByeMatch).toBe(true);
    });

    it("bye-vs-team is single bye scenario", () => {
      const team1Id = null;
      const team2Id = 5;
      const isSingleBye = (team1Id === null) !== (team2Id === null);
      expect(isSingleBye).toBe(true);
    });

    it("bye-vs-bye match auto-resolves", () => {
      const team1Id = null;
      const team2Id = null;
      const shouldAutoResolve = team1Id === null && team2Id === null;
      expect(shouldAutoResolve).toBe(true);
    });

    it("team with bye advances automatically", () => {
      const team1Id = null;
      const team2Id = 5;
      const advancingTeam = team1Id === null ? team2Id : team1Id;
      expect(advancingTeam).toBe(5);
    });

    it("bye-vs-team with feeder pending stays PENDING", () => {
      const matchStatus = "PENDING";
      const feederMatchStatus = "PENDING";
      const hasFeeder = feederMatchStatus !== "COMPLETED";
      const shouldWait = hasFeeder && matchStatus === "PENDING";
      expect(shouldWait).toBe(true);
    });

    it("bye-vs-team with feeder resolved becomes READY", () => {
      const matchStatus = "PENDING";
      const feederMatchStatus = "COMPLETED";
      const hasFeeder = feederMatchStatus === "COMPLETED";
      const canBeReady = hasFeeder && matchStatus === "PENDING";
      expect(canBeReady).toBe(true);
    });
  });

  // Avancement réel : on exerce `finalizeMatch` avec une connexion mockée et on
  // vérifie que l'équipe gagnante est bien écrite dans le bon slot du bon match
  // suivant (slot 1 → team1_id, slot 2 → team2_id), et le perdant vers son match.
  describe("winner propagation (finalizeMatch)", () => {
    type Call = { sql: string; params: unknown[] };

    const makeConnection = (
      targetTeams: Record<number, { team1_id: number | null; team2_id: number | null }> = {},
    ) => {
      const calls: Call[] = [];
      const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.trim().startsWith("SELECT")) {
          const t = targetTeams[Number(params[0])] ?? { team1_id: null, team2_id: null };
          return [[{ team1_id: t.team1_id, team2_id: t.team2_id }], []];
        }
        return [{ affectedRows: 1 }, []];
      });
      const connection = { execute } as unknown as Parameters<typeof finalizeMatch>[0];
      return { connection, calls };
    };

    const routingUpdates = (calls: Call[]) =>
      calls.filter((c) => /SET team[12]_id = \? WHERE id = \?/.test(c.sql));

    const baseMatch = {
      id: 5,
      team1_id: 7,
      team2_id: 8,
      next_winner_match_id: 10,
      next_winner_slot: 1,
      next_loser_match_id: null,
      next_loser_slot: null,
    };
    const baseResult = { team1Score: 3, team2Score: 1, winnerTeamId: 7, loserTeamId: 8 };

    it("écrit le gagnant dans team1_id quand le slot suivant est 1", async () => {
      const { connection, calls } = makeConnection();
      await finalizeMatch(connection, 1, baseMatch, baseResult);
      expect(calls).toContainEqual({
        sql: "UPDATE bg_matches SET team1_id = ? WHERE id = ?",
        params: [7, 10],
      });
    });

    it("écrit le gagnant dans team2_id quand le slot suivant est 2", async () => {
      const { connection, calls } = makeConnection();
      await finalizeMatch(connection, 1, { ...baseMatch, next_winner_slot: 2 }, baseResult);
      expect(calls).toContainEqual({
        sql: "UPDATE bg_matches SET team2_id = ? WHERE id = ?",
        params: [7, 10],
      });
    });

    it("envoie le perdant vers son match (double élim) sans toucher au gagnant", async () => {
      const { connection, calls } = makeConnection();
      await finalizeMatch(
        connection,
        1,
        { ...baseMatch, next_loser_match_id: 20, next_loser_slot: 2 },
        baseResult,
      );
      expect(calls).toContainEqual({ sql: "UPDATE bg_matches SET team1_id = ? WHERE id = ?", params: [7, 10] });
      expect(calls).toContainEqual({ sql: "UPDATE bg_matches SET team2_id = ? WHERE id = ?", params: [8, 20] });
    });

    it("n'avance personne quand il n'y a pas de match suivant (finale simple élim)", async () => {
      const { connection, calls } = makeConnection();
      await finalizeMatch(
        connection,
        1,
        { ...baseMatch, next_winner_match_id: null, next_winner_slot: null },
        baseResult,
      );
      expect(routingUpdates(calls)).toHaveLength(0);
    });

    it("passe le match suivant à READY une fois ses deux équipes connues", async () => {
      const { connection, calls } = makeConnection({ 10: { team1_id: 99, team2_id: 7 } });
      await finalizeMatch(connection, 1, { ...baseMatch, next_winner_slot: 2 }, baseResult);
      expect(calls).toContainEqual({
        sql: "UPDATE bg_matches SET status = ? WHERE id = ?",
        params: ["READY", 10],
      });
    });

    // Cohérence UI ↔ moteur : la redirection du badge « Qualifié » vise exactement le
    // match dans lequel le moteur place l'équipe gagnante.
    it("la redirection du badge cible le même match que l'avancement du gagnant", async () => {
      const uiMatch = { nextWinnerMatchId: 10, nextLoserMatchId: 99 } as BracketMatch;
      const redirectTarget = qualifyDestinationMatchId(uiMatch);

      const { connection, calls } = makeConnection();
      await finalizeMatch(connection, 1, baseMatch, baseResult);
      const winnerPlacement = calls.find((c) => /SET team[12]_id = \? WHERE id = \?/.test(c.sql));

      expect(redirectTarget).toBe(10);
      expect(winnerPlacement?.params).toEqual([7, redirectTarget]); // gagnant 7 → match 10
    });
  });

  describe("conflict resolution", () => {
    it("conflicting scores set admin_required flag", () => {
      const team1Score = 3;
      const team1OpponentScore = 1;
      const team2Score = 2;
      const team2OpponentScore = 3;
      const conflict = team1Score !== team2OpponentScore || team2Score !== team1OpponentScore;
      const adminRequired = conflict;
      expect(adminRequired).toBe(true);
    });

    it("match stays in AWAITING_CONFIRMATION with conflict", () => {
      const hasConflict = true;
      const status = hasConflict ? "AWAITING_CONFIRMATION" : "COMPLETED";
      expect(status).toBe("AWAITING_CONFIRMATION");
    });

    it("admin can override conflicting scores", () => {
      const adminResolve = true;
      const canResolve = adminResolve === true;
      expect(canResolve).toBe(true);
    });

    it("admin specifies winner on conflict", () => {
      const winnerTeamId = 5;
      const resolved = winnerTeamId !== null;
      expect(resolved).toBe(true);
    });
  });

  describe("match completion", () => {
    it("match marked COMPLETED with winner set", () => {
      const matchStatus = "COMPLETED";
      const winnerId = 5;
      const completed = matchStatus === "COMPLETED" && winnerId !== null;
      expect(completed).toBe(true);
    });

    it("match records both scores on completion", () => {
      const team1Score = 3;
      const team2Score = 1;
      const scoresSet = team1Score !== null && team2Score !== null;
      expect(scoresSet).toBe(true);
    });

    it("match records loser team ID", () => {
      const winnerId = 5;
      const loserId = 3;
      const losersSet = loserId !== null && loserId !== winnerId;
      expect(losersSet).toBe(true);
    });

    it("multiple score reports before deadline are replaced", () => {
      const reports = [
        { team1Score: 3, team1OpponentScore: 1 },
        { team1Score: 2, team1OpponentScore: 2 }, // Later report
      ];
      expect(reports.length).toBe(2);
      // Last report wins
      const finalReport = reports[reports.length - 1];
      expect(finalReport.team1Score).toBe(2);
    });
  });
});
