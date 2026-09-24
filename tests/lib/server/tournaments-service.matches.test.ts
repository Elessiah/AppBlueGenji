import { beforeEach, describe, it, expect, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import type { BracketMatch } from "@/lib/shared/types";

jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/state");

import { finalizeMatch, reportMatchScore } from "@/lib/server/tournaments/scoring";
import { queueRefereeAlert } from "@/lib/server/tournaments/bot-logs";
import { resolveUserEntrantTeamId } from "@/lib/server/tournaments/registration";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { qualifyDestinationMatchId } from "@/app/(secured)/tournois/[id]/_lib/bracket-sections";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";
import { tournamentRow } from "../../helpers/tournament-rows";

describe("tournaments-service: match state machine", () => {
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

  // Cycle de report : chaque engagée saisit son score, l'accord clôt la
  // rencontre, le désaccord la laisse en attente et alerte l'arbitrage.
  describe("score reporting (reportMatchScore)", () => {
    type Row = {
      status: string;
      team1_id: number | null;
      team2_id: number | null;
      team1_report_score: number | null;
      team1_report_opponent_score: number | null;
      team2_report_score: number | null;
      team2_report_opponent_score: number | null;
      launched_at: string | null;
      launch_pairing: string | null;
    };
    type Call = { sql: string; params: unknown[] };

    /**
     * Connexion à état : les reports écrits sont relus par la seconde lecture du
     * match, comme en base — c'est elle qui décide de l'accord.
     */
    function reportConnection(overrides: Partial<Row> = {}) {
      const row: Row = {
        status: "READY",
        team1_id: 100,
        team2_id: 200,
        team1_report_score: null,
        team1_report_opponent_score: null,
        team2_report_score: null,
        team2_report_opponent_score: null,
        // Un match se joue une fois lancé (`lib/shared/match-launch.ts`).
        launched_at: "2026-01-01 20:00:00",
        launch_pairing: "100:200",
        ...overrides,
      };
      const calls: Call[] = [];
      const execute = async (sql: string, params: unknown[] = []) => {
        const q = sql.replace(/\s+/g, " ").trim();
        calls.push({ sql: q, params });
        if (q.includes("FROM bg_tournaments")) {
          return [
            [
              {
                format: "SINGLE",
                match_format_type: null,
                match_format_value: null,
                match_format_max_maps: null,
                match_format_draws: 0,
                endurance_playoff_format_type: null,
                endurance_playoff_format_value: null,
              },
            ],
            [],
          ];
        }
        if (q.startsWith("SELECT") && q.includes("FROM bg_matches")) {
          return [
            [
              {
                id: 10,
                tournament_id: 1,
                round_number: 1,
                ...row,
                next_winner_match_id: null,
                next_winner_slot: null,
                next_loser_match_id: null,
                next_loser_slot: null,
                winner_team_id: null,
              },
            ],
            [],
          ];
        }
        if (q.startsWith("UPDATE bg_matches SET team1_report_score")) {
          [row.team1_report_score, row.team1_report_opponent_score] = params as number[];
        }
        if (q.startsWith("UPDATE bg_matches SET team2_report_score")) {
          [row.team2_report_score, row.team2_report_opponent_score] = params as number[];
        }
        return [{ affectedRows: 1 }, []];
      };
      return { connection: { execute } as unknown as PoolConnection, calls };
    }

    const writes = (calls: Call[]) => calls.filter((c) => c.sql.startsWith("UPDATE"));
    const completion = (calls: Call[]) =>
      calls.find((c) => c.sql.includes("status = 'COMPLETED'"));

    function reporterIs(teamId: number | null, state: TournamentRow["state"] = "RUNNING") {
      jest.mocked(syncTournamentState).mockResolvedValue({
        row: tournamentRow({ id: 1, state, participant_type: "TEAM" }),
        stateChanged: false,
        contentChanged: false,
        launchesChanged: false,
      });
      jest.mocked(resolveUserEntrantTeamId).mockResolvedValue(teamId);
    }

    beforeEach(() => {
      jest.clearAllMocks();
      reporterIs(100);
    });

    it("un premier report met la rencontre en attente de confirmation, délai armé", async () => {
      const { connection, calls } = reportConnection();

      await reportMatchScore(connection, 1, 10, 42, 3, 1);

      expect(writes(calls)).toHaveLength(1);
      const [report] = writes(calls);
      expect(report.sql).toMatch(/SET team1_report_score = \?/);
      expect(report.sql).toMatch(/status = 'AWAITING_CONFIRMATION'/);
      expect(report.params).toEqual([3, 1, SCORE_REPORT_TIMEOUT_MINUTES, 10]);
      expect(completion(calls)).toBeUndefined();
      expect(queueRefereeAlert).not.toHaveBeenCalled();
    });

    it("l'engagée 2 écrit dans ses propres colonnes", async () => {
      reporterIs(200);
      const { connection, calls } = reportConnection();

      await reportMatchScore(connection, 1, 10, 42, 1, 3);

      expect(writes(calls)[0].sql).toMatch(/SET team2_report_score = \?/);
      expect(writes(calls)[0].params).toEqual([1, 3, SCORE_REPORT_TIMEOUT_MINUTES, 10]);
    });

    it("deux reports concordants clôturent la rencontre au profit du vainqueur", async () => {
      const { connection, calls } = reportConnection({
        status: "AWAITING_CONFIRMATION",
        team2_report_score: 1,
        team2_report_opponent_score: 3,
      });

      await reportMatchScore(connection, 1, 10, 42, 3, 1);

      // team1_score, team2_score, vainqueur, perdant, match.
      expect(completion(calls)?.params).toEqual([3, 1, 100, 200, 10]);
      expect(queueRefereeAlert).not.toHaveBeenCalled();
    });

    it("la concordance se lit du point de vue de chaque engagée", async () => {
      reporterIs(200);
      const { connection, calls } = reportConnection({
        status: "AWAITING_CONFIRMATION",
        team1_report_score: 1,
        team1_report_opponent_score: 3,
      });

      await reportMatchScore(connection, 1, 10, 42, 3, 1);

      expect(completion(calls)?.params).toEqual([1, 3, 200, 100, 10]);
    });

    it("deux reports contradictoires laissent la rencontre en attente et alertent l'arbitrage", async () => {
      const { connection, calls } = reportConnection({
        status: "AWAITING_CONFIRMATION",
        team2_report_score: 3,
        team2_report_opponent_score: 2,
      });

      await reportMatchScore(connection, 1, 10, 42, 3, 1);

      expect(completion(calls)).toBeUndefined();
      expect(calls.map((c) => c.sql)).toContain(
        "UPDATE bg_matches SET status = 'AWAITING_CONFIRMATION' WHERE id = ?",
      );
      expect(queueRefereeAlert).toHaveBeenCalledWith(connection, {
        kind: "score_conflict",
        matchId: 10,
      });
    });

    it.each<[string, number, string]>([
      ["hors bornes (négatif)", -1, "INVALID_SCORE_RANGE"],
      ["hors bornes (au-delà de 99)", 100, "INVALID_SCORE_RANGE"],
      ["non fini", Number.NaN, "INVALID_SCORE"],
    ])("refuse un score %s avant toute lecture", async (_label, score, error) => {
      const { connection, calls } = reportConnection();

      await expect(reportMatchScore(connection, 1, 10, 42, score, 1)).rejects.toThrow(error);
      expect(syncTournamentState).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    });

    it("refuse un report sur un tournoi qui n'est pas en cours", async () => {
      reporterIs(100, "FINISHED");
      const { connection, calls } = reportConnection();

      await expect(reportMatchScore(connection, 1, 10, 42, 3, 1)).rejects.toThrow(
        "TOURNAMENT_NOT_RUNNING",
      );
      expect(writes(calls)).toHaveLength(0);
    });

    it("refuse un joueur sans engagé dans le tournoi", async () => {
      reporterIs(null);
      const { connection, calls } = reportConnection();

      await expect(reportMatchScore(connection, 1, 10, 42, 3, 1)).rejects.toThrow("NO_ACTIVE_TEAM");
      expect(writes(calls)).toHaveLength(0);
    });

    it("refuse une engagée étrangère à la rencontre", async () => {
      reporterIs(300);
      const { connection, calls } = reportConnection();

      await expect(reportMatchScore(connection, 1, 10, 42, 3, 1)).rejects.toThrow("NOT_IN_MATCH");
      expect(writes(calls)).toHaveLength(0);
    });

    it("refuse une rencontre dont un adversaire n'est pas encore connu", async () => {
      const { connection, calls } = reportConnection({ status: "PENDING", team2_id: null });

      await expect(reportMatchScore(connection, 1, 10, 42, 3, 1)).rejects.toThrow("MATCH_NOT_READY");
      expect(writes(calls)).toHaveLength(0);
    });

    it("refuse une rencontre déjà tranchée", async () => {
      const { connection, calls } = reportConnection({ status: "COMPLETED" });

      await expect(reportMatchScore(connection, 1, 10, 42, 3, 1)).rejects.toThrow(
        "MATCH_ALREADY_COMPLETED",
      );
      expect(writes(calls)).toHaveLength(0);
    });
  });
});
