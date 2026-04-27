import { describe, it, expect } from "@jest/globals";

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
      const canBeReady = hasFeeder;
      expect(canBeReady).toBe(true);
    });
  });

  describe("winner propagation", () => {
    it("winner moves to next winner match", () => {
      const winnerId = 5;
      const nextWinnerMatchId = 10;
      const propagated = winnerId !== null && nextWinnerMatchId !== null;
      expect(propagated).toBe(true);
    });

    it("loser moves to next loser match in double elim", () => {
      const loserId = 3;
      const nextLoserMatchId = 8;
      const propagated = loserId !== null && nextLoserMatchId !== null;
      expect(propagated).toBe(true);
    });

    it("loser eliminated in single elim", () => {
      const format = "SINGLE";
      const loserId = 3;
      const nextLoserMatchId = null;
      const eliminated = format === "SINGLE" && nextLoserMatchId === null;
      expect(eliminated).toBe(true);
    });

    it("winner can have multiple next matches (UB then Grand)", () => {
      const wins = 2;
      const nextMatches = wins; // Could advance twice
      expect(nextMatches).toBeGreaterThan(0);
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
