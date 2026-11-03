import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/preview-cache");
jest.mock("@/lib/server/tournaments/list-cache");
jest.mock("@/lib/server/landing-cache");
jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/survival");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/bg-survie/reconcile");
jest.mock("@/lib/server/tournaments/phases");

import { CANCEL_LOCK_WAIT_SECONDS, cancelTournamentForfeit } from "@/lib/server/tournaments/forfeit-cancellation";
import { getDatabase } from "@/lib/server/database";
import { flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { publishMatchUpdatedEvent, publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { invalidateTournamentPreview } from "@/lib/server/tournaments/preview-cache";
import { invalidateTournamentLists } from "@/lib/server/tournaments/list-cache";
import { invalidateLandingAggregates } from "@/lib/server/landing-cache";
import { reconcileSurvival } from "@/lib/server/tournaments/survival";
import { reconcileSwiss } from "@/lib/server/tournaments/swiss";
import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie/reconcile";
import { reconcilePhases } from "@/lib/server/tournaments/phases";
import { connectionMock, fakeConnection, fakePool } from "../../helpers/sql-double";

/**
 * `cancelTournamentForfeit` : toutes les lectures sont verrouillantes jusqu'aux
 * manches postérieures (ERREUR.txt EF-15 — sous MariaDB, une lecture
 * d'instantané avant elles ferait échouer leur `FOR UPDATE` en `ER_CHECKREAD`
 * au premier « Prêt » concurrent), un délai d'attente de verrou court, et une
 * seule écriture — le statut — avant le rejeu du moteur concerné.
 */

type Head = {
  format?: string;
  state?: string;
  endurance_playoffs_started?: number;
  current_phase_id?: number | null;
};

const LATER_ROUNDS = /^SELECT id FROM bg_matches WHERE tournament_id = \? AND phase_id = \? AND round_number > \?/;
const LOCKING = /FOR UPDATE$|LOCK IN SHARE MODE$/;

function setup(options: {
  head?: Head | null;
  phase?: { format: string } | null;
  standing?: { status: string; forfeit_round?: number } | null;
  /** Une manche postérieure porte une saisie. */
  laterInput?: boolean;
  /** Interblocages rendus par la lecture des manches postérieures. */
  laterBusy?: number;
} = {}) {
  const head =
    options.head === null
      ? null
      : {
          name: "BlueGenji Open",
          format: "SURVIVAL",
          state: "RUNNING",
          participant_type: "TEAM",
          endurance_playoffs_started: 0,
          current_phase_id: null,
          ...options.head,
        };
  const standing =
    options.standing === undefined ? { status: "FORFEIT", forfeit_round: 2 } : options.standing;
  const sqls: string[] = [];
  const params: unknown[] = [];
  const queries: string[] = [];
  const connection = { ...connectionMock(), destroy: jest.fn<() => void>() };
  let busy = options.laterBusy ?? 0;
  connection.query.mockImplementation(async (sql: string) => {
    queries.push(sql);
    return [{ affectedRows: 0 }];
  });
  connection.execute.mockImplementation(async (sql: string, values?: unknown) => {
    const flat = sql.replace(/\s+/g, " ").trim();
    sqls.push(flat);
    params.push(values);
    if (LATER_ROUNDS.test(flat)) {
      if (busy > 0) {
        busy -= 1;
        throw Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), {
          code: "ER_LOCK_DEADLOCK",
        });
      }
      return [options.laterInput ? [{ id: 301 }] : []];
    }
    if (/FROM bg_tournaments WHERE id/.test(flat)) return [head ? [head] : []];
    if (/FROM bg_tournament_phases/.test(flat)) return [options.phase ? [options.phase] : []];
    if (/^SELECT status, \w+ AS forfeit_round FROM/.test(flat)) return [standing ? [standing] : []];
    if (/^SELECT name FROM bg_teams/.test(flat)) return [[{ name: "Team Nova" }]];
    return [{ affectedRows: 1 }];
  });
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ getConnection: jest.fn(async () => fakeConnection(connection)) }),
  );
  return { connection, sqls, params, queries };
}

describe("cancelTournamentForfeit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("cancel_nominal_setsShortLockWaitBeforeTransaction", async () => {
    const { connection, queries } = setup();

    await cancelTournamentForfeit(7, 102);

    expect(queries[0]).toBe(`SET SESSION innodb_lock_wait_timeout = ${CANCEL_LOCK_WAIT_SECONDS}`);
    expect(CANCEL_LOCK_WAIT_SECONDS).toBe(5);
    expect(connection.query.mock.invocationCallOrder[0]).toBeLessThan(
      connection.beginTransaction.mock.invocationCallOrder[0],
    );
  });

  it("cancel_nominal_locksTournamentHeadFirst", async () => {
    const { sqls } = setup();

    await cancelTournamentForfeit(7, 102);

    expect(sqls[0]).toMatch(/FROM bg_tournaments WHERE id = \? LIMIT 1 FOR UPDATE$/);
    expect(sqls[0]).toContain("current_phase_id");
  });

  it("cancel_multiPhase_everyReadBeforeLaterRoundsIsLocking", async () => {
    const { sqls } = setup({ head: { format: "MULTI", current_phase_id: 12 }, phase: { format: "SWISS" } });

    await cancelTournamentForfeit(7, 102);

    const later = sqls.findIndex((sql) => LATER_ROUNDS.test(sql));
    expect(later).toBe(3);
    expect(sqls.slice(0, later + 1).every((sql) => LOCKING.test(sql))).toBe(true);
    expect(sqls[1]).toMatch(/^SELECT format FROM bg_tournament_phases WHERE id = \? LIMIT 1 LOCK IN SHARE MODE$/);
  });

  it("cancel_survival_reactivatesReplaysAndPublishesSnapshotAfterCommit", async () => {
    const { sqls, params, connection } = setup();

    const result = await cancelTournamentForfeit(7, 102);

    const update = sqls.findIndex((sql) => sql.startsWith("UPDATE bg_survival_standings"));
    expect(sqls[update]).toBe(
      "UPDATE bg_survival_standings SET status = 'ACTIVE', eliminated_round = NULL WHERE tournament_id = ? AND phase_id = ? AND team_id = ?",
    );
    expect(params[update]).toEqual([7, 0, 102]);
    expect(reconcileSurvival).toHaveBeenCalledWith(7, fakeConnection(connection), { phaseId: 0 });
    expect(reconcilePhases).not.toHaveBeenCalled();
    expect(flushBotLogs).toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
    expect(invalidateTournamentPreview).toHaveBeenCalledWith(7);
    // Le rejeu peut réécrire la manche courante ou la phase : listes et
    // agrégats de l'accueil suivent, pas le classement du site.
    expect(invalidateTournamentLists).toHaveBeenCalled();
    expect(invalidateLandingAggregates).toHaveBeenCalled();
    expect(jest.mocked(publishMatchUpdatedEvent).mock.invocationCallOrder[0]).toBeGreaterThan(
      connection.commit.mock.invocationCallOrder[0],
    );
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      tournamentId: 7,
      tournamentName: "BlueGenji Open",
      teamId: 102,
      entrantName: "Team Nova",
      participantType: "TEAM",
    });
  });

  it("cancel_standingRead_lockedByScopeWithoutJoin", async () => {
    const { sqls, params } = setup();

    await cancelTournamentForfeit(7, 102);

    const read = sqls.findIndex((sql) => sql.startsWith("SELECT status,"));
    expect(sqls[read]).toBe(
      "SELECT status, eliminated_round AS forfeit_round FROM bg_survival_standings WHERE tournament_id = ? AND phase_id = ? AND team_id = ? LIMIT 1 FOR UPDATE",
    );
    expect(params[read]).toEqual([7, 0, 102]);
  });

  it("cancel_laterRounds_scopedToPhaseAfterForfeitRound_locked", async () => {
    const { sqls, params } = setup();

    await cancelTournamentForfeit(7, 102);

    const later = sqls.findIndex((sql) => LATER_ROUNDS.test(sql));
    expect(sqls[later]).toMatch(/LIMIT 1 FOR UPDATE$/);
    expect(sqls[later]).not.toMatch(/JOIN|round_number < \?/);
    expect(params[later]).toEqual([7, 0, 2]);
  });

  it("cancel_laterRoundInput_refusesWithForfeitRoundPassed", async () => {
    const { sqls, connection } = setup({ laterInput: true });

    await expect(cancelTournamentForfeit(7, 102)).rejects.toThrow("FORFEIT_ROUND_PASSED");

    expect(sqls.some((sql) => sql.startsWith("UPDATE"))).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("cancel_deadlockOnReplay_retriesWholeTransactionAndPublishesOnce", async () => {
    const { connection } = setup();
    const deadlock = Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK" });
    jest.mocked(reconcileSurvival).mockRejectedValueOnce(deadlock);

    const result = await cancelTournamentForfeit(7, 102);

    expect(result.entrantName).toBe("Team Nova");
    expect(reconcileSurvival).toHaveBeenCalledTimes(2);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(2);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledTimes(1);
  });

  it("cancel_concurrentReportDeadlock_replayThenRefuses", async () => {
    const { connection } = setup({ laterBusy: 1 });
    let attempt = 0;
    connection.beginTransaction.mockImplementation(async () => {
      attempt += 1;
    });
    // Au rejeu, le report concurrent est commité : la manche porte sa saisie.
    const execute = connection.execute.getMockImplementation();
    connection.execute.mockImplementation(async (sql: string, values?: unknown) => {
      if (attempt > 1 && LATER_ROUNDS.test(sql.replace(/\s+/g, " ").trim())) return [[{ id: 301 }]];
      return execute!(sql, values);
    });

    await expect(cancelTournamentForfeit(7, 102)).rejects.toThrow("FORFEIT_ROUND_PASSED");

    expect(attempt).toBe(2);
    expect(connection.rollback).toHaveBeenCalledTimes(2);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(reconcileSurvival).not.toHaveBeenCalled();
  });

  it("cancel_otherLockError_propagatesWithoutRetry", async () => {
    const { connection } = setup();
    const execute = connection.execute.getMockImplementation();
    connection.execute.mockImplementation(async (sql: string, values?: unknown) => {
      if (/round_number > \?/.test(sql)) throw Object.assign(new Error("boom"), { code: "ER_PARSE_ERROR" });
      return execute!(sql, values);
    });

    await expect(cancelTournamentForfeit(7, 102)).rejects.toThrow("boom");

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
  });

  it("cancel_lockWaitTimeout_propagatesWithoutRetry", async () => {
    const { connection } = setup();
    const execute = connection.execute.getMockImplementation();
    connection.execute.mockImplementation(async (sql: string, values?: unknown) => {
      if (/round_number > \?/.test(sql)) {
        throw Object.assign(new Error("Lock wait timeout exceeded; try restarting transaction"), {
          code: "ER_LOCK_WAIT_TIMEOUT",
        });
      }
      return execute!(sql, values);
    });

    await expect(cancelTournamentForfeit(7, 102)).rejects.toThrow("Lock wait timeout exceeded");

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it("cancel_businessRefusal_notRetried", async () => {
    const { connection } = setup({ standing: { status: "ACTIVE" } });

    await expect(cancelTournamentForfeit(7, 102)).rejects.toThrow("TEAM_NOT_FORFEITED");

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
  });

  it("cancel_nominal_writesOnlyTheStatus", async () => {
    const { sqls } = setup();

    await cancelTournamentForfeit(7, 102);

    expect(sqls.some((sql) => /^(UPDATE|DELETE|INSERT).*bg_matches/.test(sql))).toBe(false);
  });

  it("cancel_swiss_clearsForfeitRound", async () => {
    const { sqls, connection } = setup({ head: { format: "SWISS" } });

    await cancelTournamentForfeit(7, 102);

    expect(sqls.find((sql) => sql.startsWith("UPDATE bg_swiss_standings"))).toContain("forfeit_round = NULL");
    expect(reconcileSwiss).toHaveBeenCalledWith(7, fakeConnection(connection), { phaseId: 0 });
  });

  it("cancel_bgSurvie_replaysEnduranceWithoutPhase", async () => {
    const { sqls, params, connection } = setup({ head: { format: "BG_SURVIE" } });

    await cancelTournamentForfeit(7, 102);

    const update = sqls.findIndex((sql) => sql.startsWith("UPDATE bg_endurance_standings"));
    expect(params[update]).toEqual([7, 102]);
    expect(reconcileEndurance).toHaveBeenCalledWith(7, fakeConnection(connection));
  });

  it("cancel_multiPhase_followsCurrentPhaseAndLetsReconcilePhasesReplay", async () => {
    const { params, sqls, connection } = setup({
      head: { format: "MULTI", current_phase_id: 12 },
      phase: { format: "SWISS" },
    });

    await cancelTournamentForfeit(7, 102);

    expect(params[1]).toEqual([12]);
    const update = sqls.findIndex((sql) => sql.startsWith("UPDATE bg_swiss_standings"));
    expect(params[update]).toEqual([7, 12, 102]);
    const later = sqls.findIndex((sql) => LATER_ROUNDS.test(sql));
    expect(params[later]).toEqual([7, 12, 2]);
    // Le moteur n'est pas appelé en direct : sa cible de qualifiées vient de
    // la phase, que seul `reconcilePhases` connaît.
    expect(reconcileSwiss).not.toHaveBeenCalled();
    expect(reconcilePhases).toHaveBeenCalledWith(7, fakeConnection(connection));
  });

  it("cancel_multiPhaseWithoutCurrentPhase_refusesWithoutReadingPhase", async () => {
    const { sqls } = setup({ head: { format: "MULTI", current_phase_id: null } });

    await expect(cancelTournamentForfeit(7, 102)).rejects.toThrow("FORMAT_WITHOUT_FORFEIT");

    expect(sqls.some((sql) => sql.includes("bg_tournament_phases"))).toBe(false);
  });

  it("cancel_finally_restoresServerLockWaitThenReleases", async () => {
    const { connection, queries } = setup();

    await cancelTournamentForfeit(7, 102);

    expect(queries.at(-1)).toBe("SET SESSION innodb_lock_wait_timeout = DEFAULT");
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it("cancel_refusal_stillRestoresServerLockWait", async () => {
    const { queries, connection } = setup({ standing: null });

    await expect(cancelTournamentForfeit(7, 102)).rejects.toThrow("TEAM_NOT_IN_TOURNAMENT");

    expect(queries.at(-1)).toBe("SET SESSION innodb_lock_wait_timeout = DEFAULT");
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("cancel_restoreFails_destroysConnectionInsteadOfReleasing", async () => {
    const { connection } = setup();
    connection.query.mockImplementation(async (sql: string) => {
      if (sql.endsWith("DEFAULT")) throw new Error("Connection lost");
      return [{ affectedRows: 0 }];
    });

    await cancelTournamentForfeit(7, 102);

    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it.each([
    ["TOURNAMENT_NOT_FOUND", { head: null }],
    ["TOURNAMENT_NOT_RUNNING", { head: { state: "FINISHED" } }],
    ["FORMAT_WITHOUT_FORFEIT", { head: { format: "SINGLE" } }],
    ["FORMAT_WITHOUT_FORFEIT", { head: { format: "MULTI", current_phase_id: 3 }, phase: { format: "DOUBLE" } }],
    ["ENDURANCE_PLAYOFFS_STARTED", { head: { format: "BG_SURVIE", endurance_playoffs_started: 1 } }],
    ["TEAM_NOT_IN_TOURNAMENT", { standing: null }],
    ["TEAM_NOT_FORFEITED", { standing: { status: "ACTIVE" } }],
    ["TEAM_NOT_FORFEITED", { standing: { status: "ELIMINATED" } }],
    ["FORFEIT_ROUND_PASSED", { laterInput: true }],
  ])("refuse en %s, sans rien écrire", async (code, options) => {
    const { sqls, connection } = setup(options);

    await expect(cancelTournamentForfeit(7, 102)).rejects.toThrow(code);

    expect(sqls.some((sql) => sql.startsWith("UPDATE"))).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    expect(invalidateTournamentPreview).not.toHaveBeenCalled();
    expect(invalidateTournamentLists).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });
});
