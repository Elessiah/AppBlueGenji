import { beforeEach, describe, it, expect, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import type { BracketMatch } from "@/lib/shared/types";

jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/state");

import { finalizeMatch, reportMatchScore } from "@/lib/server/tournaments/scoring";
import { queueRefereeAlert } from "@/lib/server/tournaments/bot-logs";
import { resolveUserEntrant } from "@/lib/server/tournaments/registration";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { plausibleSeriesMinutes } from "@/lib/shared/score-report-deadline";
import { qualifyDestinationMatchId } from "@/app/(secured)/tournois/[id]/_lib/bracket-sections";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";
import { tournamentRow } from "../../helpers/tournament-rows";
import { mapsFor } from "../../helpers/match-maps";

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
      team1_reported_at?: Date | null;
      team2_reported_at?: Date | null;
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
        // Une proposition map par map existe (le report vient de l'écrire).
        if (q.startsWith("SELECT match_id, source, map_number, replay_code, team1_score, team2_score, submitted_by_user_id")) return [[{ match_id: 10, source: "TEAM1", map_number: 1, replay_code: "MAP001", team1_score: 2, team2_score: 0 }], []];
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
    /**
     * Paramètres de l'écriture d'un report : scores, puis ceux de l'échéance —
     * délai, délai (branche « l'adversaire a déjà reporté »), minutes de série,
     * délai (branche « report seul ») —, puis le match.
     */
    const reportParams = (my: number, opp: number) => [
      my,
      opp,
      SCORE_REPORT_TIMEOUT_MINUTES,
      SCORE_REPORT_TIMEOUT_MINUTES,
      plausibleSeriesMinutes(null),
      SCORE_REPORT_TIMEOUT_MINUTES,
      10,
    ];
    const completion = (calls: Call[]) =>
      calls.find((c) => c.sql.includes("status = 'COMPLETED'"));

    function reporterIs(
      teamId: number | null,
      state: TournamentRow["state"] = "RUNNING",
      canConductMatch = true,
    ) {
      jest.mocked(syncTournamentState).mockResolvedValue({
        row: tournamentRow({ id: 1, state, participant_type: "TEAM" }),
        stateChanged: false,
        contentChanged: false,
        launchesChanged: false,
      });
      jest.mocked(resolveUserEntrant).mockResolvedValue({
        teamId,
        canActForEntrant: canConductMatch,
        canConductMatch,
      });
    }

    beforeEach(() => {
      jest.clearAllMocks();
      reporterIs(100);
    });

    it("un premier report met la rencontre en attente de confirmation, délai armé", async () => {
      const { connection, calls } = reportConnection();

      await reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1));

      expect(writes(calls)).toHaveLength(1);
      const [report] = writes(calls);
      expect(report.sql).toMatch(/SET team1_report_score = \?/);
      expect(report.sql).toMatch(/status = 'AWAITING_CONFIRMATION'/);
      // La série plausible est une série complète au format de la manche (ici
      // score libre : le BO5 par défaut), depuis le lancement, puis le délai.
      expect(report.params).toEqual(reportParams(3, 1));
      expect(completion(calls)).toBeUndefined();
      expect(queueRefereeAlert).not.toHaveBeenCalled();
    });

    it("l'échéance d'un premier report ne court qu'après une fin de série plausible", async () => {
      const { connection, calls } = reportConnection();

      await reportMatchScore(connection, 1, 10, 42, mapsFor(3, 0));

      const [report] = writes(calls);
      // Calculée par la base et posée une fois (COALESCE) : max(maintenant,
      // lancement + série) puis le délai — et le lancement ne compte que s'il
      // appartient à cet appariement.
      expect(report.sql).toMatch(/ELSE COALESCE\(score_deadline_at, DATE_ADD\( GREATEST\( NOW\(\),/);
      expect(report.sql).toMatch(
        /CASE WHEN launch_pairing = CONCAT\(team1_id, ':', team2_id\) THEN launched_at END/,
      );
      expect(report.params).toEqual(reportParams(3, 0));
    });

    it("l'échéance se lit sur le format, jamais sur le score déclaré", async () => {
      // Un « 1-0 » ne l'abrège pas, un « 3-2 » ne la repousse pas : lue sur le
      // score, elle était à la main du déclarant.
      const short = reportConnection();
      await reportMatchScore(short.connection, 1, 10, 42, mapsFor(3, 0));
      const long = reportConnection();
      await reportMatchScore(long.connection, 1, 10, 42, mapsFor(3, 2));

      expect(writes(short.calls)[0].params[4]).toBe(plausibleSeriesMinutes(null));
      expect(writes(long.calls)[0].params[4]).toBe(plausibleSeriesMinutes(null));
    });

    it("le report de l'adversaire rapproche l'échéance, sans jamais la repousser", async () => {
      // Les deux ont parlé : la série est finie, un conflit doit être signalé à
      // l'arbitrage depuis sa naissance et non depuis la fin de série
      // plausible du premier report.
      reporterIs(200);
      const { connection, calls } = reportConnection();

      // Maps dans l'orientation du plateau : l'engagée 2 en gagne 3.
      await reportMatchScore(connection, 1, 10, 42, mapsFor(1, 3));

      expect(writes(calls)[0].sql).toMatch(
        /score_deadline_at = CASE WHEN team1_report_score IS NOT NULL THEN LEAST\( COALESCE\(score_deadline_at, DATE_ADD\(NOW\(\), INTERVAL \? MINUTE\)\), DATE_ADD\(NOW\(\), INTERVAL \? MINUTE\) \)/,
      );
    });

    it("refuse un membre sportif du roster, avant toute lecture du match", async () => {
      // Un 0-3 déclaré contre soi est un forfait : le report revient à ceux qui
      // mènent le match (capitaine, manager, propriétaire).
      reporterIs(100, "RUNNING", false);
      const { connection, calls } = reportConnection();

      await expect(reportMatchScore(connection, 1, 10, 42, mapsFor(0, 3))).rejects.toThrow("NOT_TEAM_MATCH_LEADER");
      expect(calls.some((c) => c.sql.includes("FROM bg_matches"))).toBe(false);
      expect(writes(calls)).toHaveLength(0);
    });

    it("l'engagée 2 écrit dans ses propres colonnes", async () => {
      reporterIs(200);
      const { connection, calls } = reportConnection();

      // Maps dans l'orientation du plateau : 3-1 pour l'équipe 1, donc
      // « mon score » 1 et « score adverse » 3 du point de vue de l'engagée 2.
      await reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1));

      expect(writes(calls)[0].sql).toMatch(/SET team2_report_score = \?/);
      expect(writes(calls)[0].params).toEqual(reportParams(1, 3));
    });

    it("deux reports concordants clôturent la rencontre au profit du vainqueur", async () => {
      const { connection, calls } = reportConnection({
        status: "AWAITING_CONFIRMATION",
        team2_report_score: 1,
        team2_report_opponent_score: 3,
      });

      await reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1));

      // team1_score, team2_score, vainqueur, perdant, match.
      expect(completion(calls)?.params).toEqual([3, 1, 100, 200, 10]);
      expect(queueRefereeAlert).not.toHaveBeenCalled();
      // Le détail de la proposition confirmée devient le résultat retenu.
      const promote = calls.find((c) => c.sql.includes("VALUES (?, 'FINAL'"));
      expect(promote?.params).toEqual([10, 1, "MAP001", 2, 0, null, expect.any(Date)]);
    });

    it("la concordance se lit du point de vue de chaque engagée", async () => {
      reporterIs(200);
      const { connection, calls } = reportConnection({
        status: "AWAITING_CONFIRMATION",
        team1_report_score: 1,
        team1_report_opponent_score: 3,
      });

      await reportMatchScore(connection, 1, 10, 42, mapsFor(1, 3));

      expect(completion(calls)?.params).toEqual([1, 3, 200, 100, 10]);
    });

    describe("« Confirmer » la proposition adverse telle quelle (MAP_SCORES.md)", () => {
      const depositedAt = new Date("2026-10-05T20:00:00.000Z");
      const pendingTeam2 = {
        status: "AWAITING_CONFIRMATION",
        team2_report_score: 1,
        team2_report_opponent_score: 3,
        team2_reported_at: depositedAt,
      };

      it("clôt la rencontre par le même chemin qu'un envoi concordant", async () => {
        const { connection, calls } = reportConnection(pendingTeam2);

        await reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1), { reportedAt: depositedAt.toISOString() });

        expect(completion(calls)?.params).toEqual([3, 1, 100, 200, 10]);
        expect(queueRefereeAlert).not.toHaveBeenCalled();
      });

      it("refuse une proposition remplacée depuis (autre dépôt), sans rien écrire", async () => {
        const { connection, calls } = reportConnection(pendingTeam2);

        await expect(
          reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1), { reportedAt: "2026-10-05T19:00:00.000Z" }),
        ).rejects.toThrow("PROPOSAL_STALE");
        expect(writes(calls)).toHaveLength(0);
      });

      it("refuse une proposition retirée ou expirée (plus de report adverse)", async () => {
        const { connection, calls } = reportConnection();

        await expect(
          reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1), { reportedAt: depositedAt.toISOString() }),
        ).rejects.toThrow("PROPOSAL_STALE");
        expect(writes(calls)).toHaveLength(0);
      });

      it("refuse une confirmation dont les maps ne sont plus celles de l'adversaire", async () => {
        const { connection, calls } = reportConnection(pendingTeam2);
        const execute = connection.execute.bind(connection) as (sql: string, params?: unknown) => Promise<unknown>;
        (connection as unknown as { execute: typeof execute }).execute = async (sql, params) => {
          if (sql.includes("SELECT match_id, source, map_number, replay_code, team1_score, team2_score\n")
            || /^SELECT match_id, source, map_number, replay_code, team1_score, team2_score FROM/.test(sql.replace(/\s+/g, " ").trim())) {
            await execute(sql, params);
            return [mapsFor(3, 1).map((m, i) => ({
              match_id: 10, source: "TEAM2", map_number: i + 1, replay_code: `EDIT${i}`, team1_score: m.team1Score, team2_score: m.team2Score,
            })), []];
          }
          return execute(sql, params);
        };

        await expect(
          reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1), { reportedAt: depositedAt.toISOString() }),
        ).rejects.toThrow("PROPOSAL_STALE");
        expect(writes(calls)).toHaveLength(0);
      });

      it("une retouche envoyée sans confirmation devient une contre-proposition (désaccord)", async () => {
        const { connection, calls } = reportConnection(pendingTeam2);

        // L'engagé 1 retouche la proposition (3-0 au lieu de 3-1) et l'envoie.
        await reportMatchScore(connection, 1, 10, 42, mapsFor(3, 0));

        expect(completion(calls)).toBeUndefined();
        expect(queueRefereeAlert).toHaveBeenCalledWith(connection, { kind: "score_conflict", matchId: 10 });
      });
    });

    it("même score mais maps différentes : désaccord, l'arbitrage est alerté (MAP_SCORES.md)", async () => {
      const { connection, calls } = reportConnection({
        status: "AWAITING_CONFIRMATION",
        team2_report_score: 1,
        team2_report_opponent_score: 3,
      });
      const execute = connection.execute.bind(connection) as (sql: string, params?: unknown) => Promise<unknown>;
      (connection as unknown as { execute: typeof execute }).execute = async (sql, params) => {
        if (sql.includes("SELECT match_id, source, map_number")) {
          await execute(sql, params);
          // Proposition de l'engagée 2 : même 3-1, autres codes.
          return [mapsFor(3, 1).map((m, i) => ({
            match_id: 10,
            source: "TEAM2",
            map_number: i + 1,
            replay_code: `OTHER${i}`,
            team1_score: m.team1Score,
            team2_score: m.team2Score,
          })), []];
        }
        return execute(sql, params);
      };

      await reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1));

      expect(completion(calls)).toBeUndefined();
      expect(queueRefereeAlert).toHaveBeenCalledWith(connection, { kind: "score_conflict", matchId: 10 });
    });

    it("deux reports contradictoires laissent la rencontre en attente et alertent l'arbitrage", async () => {
      const { connection, calls } = reportConnection({
        status: "AWAITING_CONFIRMATION",
        team2_report_score: 3,
        team2_report_opponent_score: 2,
      });

      await reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1));

      expect(completion(calls)).toBeUndefined();
      expect(calls.map((c) => c.sql)).toContain(
        "UPDATE bg_matches SET status = 'AWAITING_CONFIRMATION' WHERE id = ?",
      );
      expect(queueRefereeAlert).toHaveBeenCalledWith(connection, {
        kind: "score_conflict",
        matchId: 10,
      });
    });

    it.each<[string, number]>([
      ["hors bornes (négatif)", -1],
      ["hors bornes (au-delà de 99)", 100],
      ["non entier", 1.5],
      ["non fini", Number.NaN],
    ])("refuse un score de map %s, sans rien écrire", async (_label, score) => {
      const { connection, calls } = reportConnection();
      const maps = mapsFor(3, 1);
      maps[0] = { ...maps[0], team1Score: score };

      await expect(reportMatchScore(connection, 1, 10, 42, maps)).rejects.toThrow("MAP_SCORE_INVALID");
      expect(writes(calls)).toHaveLength(0);
    });

    it("refuse un report sur un tournoi qui n'est pas en cours", async () => {
      reporterIs(100, "FINISHED");
      const { connection, calls } = reportConnection();

      await expect(reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1))).rejects.toThrow(
        "TOURNAMENT_NOT_RUNNING",
      );
      expect(writes(calls)).toHaveLength(0);
    });

    it("refuse un joueur sans engagé dans le tournoi", async () => {
      reporterIs(null);
      const { connection, calls } = reportConnection();

      await expect(reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1))).rejects.toThrow("NO_ACTIVE_TEAM");
      expect(writes(calls)).toHaveLength(0);
    });

    it("refuse une engagée étrangère à la rencontre", async () => {
      reporterIs(300);
      const { connection, calls } = reportConnection();

      await expect(reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1))).rejects.toThrow("NOT_IN_MATCH");
      expect(writes(calls)).toHaveLength(0);
    });

    it("refuse une rencontre dont un adversaire n'est pas encore connu", async () => {
      const { connection, calls } = reportConnection({ status: "PENDING", team2_id: null });

      await expect(reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1))).rejects.toThrow("MATCH_NOT_READY");
      expect(writes(calls)).toHaveLength(0);
    });

    it("refuse une rencontre déjà tranchée", async () => {
      const { connection, calls } = reportConnection({ status: "COMPLETED" });

      await expect(reportMatchScore(connection, 1, 10, 42, mapsFor(3, 1))).rejects.toThrow(
        "MATCH_ALREADY_COMPLETED",
      );
      expect(writes(calls)).toHaveLength(0);
    });
  });
});
