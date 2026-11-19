import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database", () => ({ getDatabase: jest.fn(), withConnection: jest.fn() }));
jest.mock("@/lib/server/named-lock", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/named-lock")>("@/lib/server/named-lock");
  return { ...actual, withNamedLock: jest.fn() };
});
jest.mock("@/lib/server/notify", () => ({
  loadEntrantMatchLeaderIds: jest.fn(),
  loadNotificationRecipients: jest.fn(),
  notifyUsers: jest.fn(),
}));
jest.mock("@/lib/server/staff-audit", () => ({ auditStaffAction: jest.fn() }));
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://bluegenji.test" }));
jest.mock("@/lib/server/tournaments/notifications", () => ({ publishMatchUpdatedEvent: jest.fn() }));
jest.mock("@/lib/server/tournaments/admin", () => ({ adminResolveMatch: jest.fn() }));
jest.mock("@/lib/server/tournaments/registration", () => ({ lockTournamentRow: jest.fn() }));
jest.mock("@/lib/server/tournaments/deadlock-retry", () => ({
  retryOnDeadlock: <T>(write: () => Promise<T>) => write(),
}));
jest.mock("@/lib/server/tournaments/index", () => ({ forfeitMissedScheduleDeadlinePublic: jest.fn() }));

import { getDatabase, withConnection } from "@/lib/server/database";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { loadEntrantMatchLeaderIds, loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { auditStaffAction } from "@/lib/server/staff-audit";
import { adminResolveMatch } from "@/lib/server/tournaments/admin";
import { forfeitMissedScheduleDeadlinePublic } from "@/lib/server/tournaments/index";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import {
  deadlineNoticesFor,
  forfeitMissedScheduleDeadline,
  NO_NOTICES,
  SCHEDULE_DEADLINES_LOCK,
  sentNoticesByMatch,
  SWEEP_MAX_FAILURES,
  type SentNotices,
  setMatchScheduleDeadline,
  setTournamentScheduleDeadlines,
  sweepAction,
  sweepScheduleDeadlines,
} from "@/lib/server/tournaments/schedule-deadline";
import type { RowColumns, RowOverrides } from "../../../helpers/row-overrides";
import { connectionMock, fakeConnection, fakePool } from "../../../helpers/sql-double";

/**
 * Date butoir de planification, côté serveur (`docs/features/SCHEDULE_DEADLINE.md`) :
 * écriture sous verrou, double forfait relu sous verrou, balayage idempotent.
 */

type SweepRow = Parameters<typeof sweepAction>[0];

const NOW = Date.parse("2026-11-16T12:00:00Z");
const DEADLINE = Date.parse("2026-11-17T20:00:00Z");
const HOUR = 60 * 60 * 1000;
const ACTOR = { id: 3, pseudo: "Arbitre" };
const MINUTE = 60 * 1000;
/** Paire du match type (`launchPairingKey(100, 200)`). */
const PAIRING = "100:200";

/** Avis partis pour la paire actuelle, le premier à `armedAt`. */
function sentFor(keys: string[], armedAt: number | null = NOW): SentNotices {
  return { keys: new Set(keys), armedAt, stale: false };
}

/** Un match **à planifier** d'un tournoi en cours, date butoir mardi 21:00 (Paris). */
function row(overrides: RowOverrides<SweepRow> = {}): SweepRow {
  const columns: RowColumns<SweepRow> = {
    id: 40,
    tournament_id: 10,
    status: "READY",
    team1_id: 100,
    team2_id: 200,
    start_at: null,
    launched_at: null,
    launch_pairing: null,
    schedule_deadline_at: new Date(DEADLINE),
    referee_scheduling: 1,
    tournament_state: "RUNNING",
    tournament_name: "Coupe",
    team1_name: "Renards",
    team2_name: "Nova",
    team1_solo: null,
    team2_solo: null,
  };
  return { ...columns, ...overrides } as SweepRow;
}

/** Réponses du double SQL, choisies par motif (la première qui correspond). */
type Route = [RegExp, () => unknown];
function routeSql(connection: ReturnType<typeof connectionMock>, routes: Route[]) {
  connection.execute.mockImplementation(async (sql: string) => {
    const found = routes.find(([pattern]) => pattern.test(sql));
    return found ? found[1]() : [[]];
  });
}

const executed = (connection: ReturnType<typeof connectionMock>, pattern: RegExp) =>
  connection.execute.mock.calls.filter(([sql]) => pattern.test(sql));

let connection: ReturnType<typeof connectionMock>;

beforeEach(() => {
  jest.clearAllMocks();
  delete (globalThis as typeof globalThis & { __bgScheduleDeadlineFailures?: Map<number, number> }).__bgScheduleDeadlineFailures;
  connection = connectionMock();
  connection.rollback.mockResolvedValue(undefined);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({}));
  jest.mocked(withConnection).mockImplementation(async (run) => run(fakeConnection(connection)));
  jest.mocked(withNamedLock).mockImplementation(async (_db, _name, _timeout, run) => run(fakeConnection(connection)));
  jest.mocked(loadEntrantMatchLeaderIds).mockResolvedValue(new Map([[100, [7]], [200, [8]]]));
  jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) => ids.map((userId) => ({ userId, discord: null })));
  jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [], pushed: 0 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("sweepAction", () => {
  it("sweepAction_noDeadline_none", () => {
    expect(sweepAction(row({ schedule_deadline_at: null }), NO_NOTICES, NOW)).toEqual({ kind: "none" });
  });

  it("sweepAction_tournamentFinished_lapse", () => {
    expect(sweepAction(row({ tournament_state: "FINISHED" }), NO_NOTICES, NOW)).toEqual({ kind: "lapse", deadlineAt: DEADLINE });
  });

  it("sweepAction_dueArmedInTime_forfeit", () => {
    expect(sweepAction(row(), sentFor(["SET"], DEADLINE - 30 * MINUTE), DEADLINE)).toEqual({ kind: "forfeit", deadlineAt: DEADLINE });
  });

  it("sweepAction_dueNeverArmed_lapse", () => {
    expect(sweepAction(row(), NO_NOTICES, DEADLINE)).toEqual({ kind: "lapse", deadlineAt: DEADLINE });
  });

  it("sweepAction_dueArmedTooLate_lapse", () => {
    // Paire complétée 29 min avant l'échéance : les équipes n'ont pas eu le temps.
    expect(sweepAction(row(), sentFor(["DL3"], DEADLINE - 29 * MINUTE), DEADLINE)).toEqual({ kind: "lapse", deadlineAt: DEADLINE });
  });

  it("sweepAction_scheduledPastDeadline_lapse", () => {
    expect(sweepAction(row({ start_at: new Date(DEADLINE + 24 * HOUR) }), sentFor(["SET"]), DEADLINE)).toEqual({
      kind: "lapse",
      deadlineAt: DEADLINE,
    });
  });

  it("sweepAction_launchedPastDeadline_lapse", () => {
    const launched = row({ launched_at: new Date(NOW), launch_pairing: PAIRING });

    expect(sweepAction(launched, sentFor(["SET"]), DEADLINE)).toEqual({ kind: "lapse", deadlineAt: DEADLINE });
  });

  it("sweepAction_dueToPlanNotRunning_lapse", () => {
    expect(sweepAction(row({ tournament_state: "REGISTRATION" }), sentFor(["SET"]), DEADLINE)).toEqual({ kind: "lapse", deadlineAt: DEADLINE });
  });

  it("sweepAction_dueMissingEntrant_lapse", () => {
    expect(sweepAction(row({ team2_id: null }), NO_NOTICES, DEADLINE)).toEqual({ kind: "lapse", deadlineAt: DEADLINE });
  });

  it("sweepAction_beforeDeadlineToPlan_remindWithDueKey", () => {
    expect(sweepAction(row(), sentFor(["SET"]), DEADLINE - 2 * HOUR)).toEqual({
      kind: "remind",
      key: "DL3",
      consumes: ["SET", "DL24", "DL3"],
      deadlineAt: DEADLINE,
    });
  });

  it("sweepAction_beforeDeadlineEntrantMissing_none", () => {
    expect(sweepAction(row({ team2_id: null }), NO_NOTICES, NOW)).toEqual({ kind: "none" });
  });

  it("sweepAction_latestStepAlreadySent_none", () => {
    expect(sweepAction(row(), sentFor(["SET"]), NOW)).toEqual({ kind: "none" });
  });
});

describe("sentNoticesByMatch", () => {
  const notice = (notice_key: string, pairing: string | null, sentAt: number) => ({ match_id: 40, notice_key, pairing, sent_at: new Date(sentAt) });

  it("sentNoticesByMatch_currentPairing_keysAndEarliestArmedAt", () => {
    const sent = sentNoticesByMatch([row()], [notice("DL24", PAIRING, NOW + HOUR), notice("SET", PAIRING, NOW)]);

    expect(sent.get(40)).toEqual({ keys: new Set(["DL24", "SET"]), armedAt: NOW, stale: false });
  });

  it("sentNoticesByMatch_otherPairing_staleWithoutKeys", () => {
    const sent = sentNoticesByMatch([row()], [notice("SET", "100:300", NOW)]);

    expect(sent.get(40)).toEqual({ keys: new Set(), armedAt: null, stale: true });
  });

  it("sentNoticesByMatch_forfeitKey_notArming", () => {
    const sent = sentNoticesByMatch([row()], [notice("FORFEIT", PAIRING, NOW)]);

    expect(sent.get(40)?.armedAt).toBeNull();
  });
});

describe("deadlineNoticesFor", () => {
  it("deadlineNoticesFor_twoTeams_oneNoticePerSideWithOpponent", () => {
    const notices = deadlineNoticesFor(row(), "SET", DEADLINE);

    expect(notices.map(({ teamId, notice }) => [teamId, notice.teamName, notice.opponentName])).toEqual([
      [100, "Renards", "Nova"],
      [200, "Nova", "Renards"],
    ]);
    expect(notices[0].notice).toMatchObject({ key: "SET", matchId: 40, tournamentId: 10, solo: false, deadlineAt: "2026-11-17T20:00:00.000Z" });
  });

  it("deadlineNoticesFor_soloEntry_flaggedSolo", () => {
    expect(deadlineNoticesFor(row({ team1_solo: 55, team2_solo: 56 }), "SET", DEADLINE)[0].notice.solo).toBe(true);
  });

  it("deadlineNoticesFor_missingSide_none", () => {
    expect(deadlineNoticesFor(row({ team1_id: null }), "SET", DEADLINE)).toEqual([]);
  });
});

describe("forfeitMissedScheduleDeadline", () => {
  const tournament = (state: string) => [[{ referee_scheduling: 1, state }]];
  const run = () => forfeitMissedScheduleDeadline(fakeConnection(connection), 10, 40, DEADLINE, DEADLINE + HOUR);

  it("forfeitMissedScheduleDeadline_dueToPlan_locksTournamentFirstAndResolvesDoubleForfeit", async () => {
    routeSql(connection, [
      [/FROM bg_tournaments/, () => tournament("RUNNING")],
      [/FROM bg_matches/, () => [[row()]]],
      [/MIN\(sent_at\)/, () => [[{ armed_at: new Date(NOW) }]]],
    ]);

    await expect(run()).resolves.toBe(true);

    expect(lockTournamentRow).toHaveBeenCalledWith(expect.anything(), 10);
    expect(jest.mocked(lockTournamentRow).mock.invocationCallOrder[0]).toBeLessThan(connection.execute.mock.invocationCallOrder[0]);
    expect(adminResolveMatch).toHaveBeenCalledWith(expect.anything(), 40, { doubleForfeit: true });
  });

  it("forfeitMissedScheduleDeadline_notArmed_false", async () => {
    routeSql(connection, [
      [/FROM bg_tournaments/, () => tournament("RUNNING")],
      [/FROM bg_matches/, () => [[row()]]],
      [/MIN\(sent_at\)/, () => [[{ armed_at: null }]]],
    ]);

    await expect(run()).resolves.toBe(false);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("forfeitMissedScheduleDeadline_tournamentNotRunning_false", async () => {
    routeSql(connection, [
      [/FROM bg_tournaments/, () => tournament("FINISHED")],
      [/FROM bg_matches/, () => [[row()]]],
    ]);

    await expect(run()).resolves.toBe(false);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("forfeitMissedScheduleDeadline_deadlineChanged_false", async () => {
    routeSql(connection, [
      [/FROM bg_tournaments/, () => tournament("RUNNING")],
      [/FROM bg_matches/, () => [[row({ schedule_deadline_at: new Date(DEADLINE + 24 * HOUR) })]]],
    ]);

    await expect(run()).resolves.toBe(false);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("forfeitMissedScheduleDeadline_scheduledMeanwhile_false", async () => {
    routeSql(connection, [
      [/FROM bg_tournaments/, () => tournament("RUNNING")],
      [/FROM bg_matches/, () => [[row({ start_at: new Date(DEADLINE + 24 * HOUR) })]]],
    ]);

    await expect(run()).resolves.toBe(false);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("forfeitMissedScheduleDeadline_rowGone_false", async () => {
    routeSql(connection, [[/FROM bg_tournaments/, () => tournament("RUNNING")]]);

    await expect(run()).resolves.toBe(false);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });
});

describe("sweepScheduleDeadlines", () => {
  const claimed = (affectedRows: number) => [{ affectedRows }];

  it("sweepScheduleDeadlines_lockHeldElsewhere_returnsEmptyReport", async () => {
    jest.mocked(withNamedLock).mockRejectedValue(new NamedLockUnavailableError(SCHEDULE_DEADLINES_LOCK, 0));

    await expect(sweepScheduleDeadlines(NOW)).resolves.toEqual({ forfeited: 0, lapsed: 0, reminded: 0 });
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("sweepScheduleDeadlines_announcementClaimed_sendsOncePerSideToMatchLeaders", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await expect(sweepScheduleDeadlines(NOW)).resolves.toEqual({ forfeited: 0, lapsed: 0, reminded: 1 });

    expect(jest.mocked(withNamedLock).mock.calls[0][1]).toBe(SCHEDULE_DEADLINES_LOCK);
    expect(loadEntrantMatchLeaderIds).toHaveBeenCalledWith([100, 200]);
    expect(jest.mocked(loadNotificationRecipients).mock.calls[0]).toEqual([[7], "proven", { matchDm: true }]);
    expect(notifyUsers).toHaveBeenCalledTimes(2);
    expect(jest.mocked(notifyUsers).mock.calls[0][1]).toMatchObject({ topic: "SCHEDULE_DEADLINE", dmFollowsTopic: true });
  });

  it("sweepScheduleDeadlines_claimLost_sendsNothing", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(0)],
    ]);

    await expect(sweepScheduleDeadlines(NOW)).resolves.toEqual({ forfeited: 0, lapsed: 0, reminded: 0 });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("sweepScheduleDeadlines_stepAlreadySent_claimsNothing", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/SELECT match_id, notice_key/, () => [[{ match_id: 40, notice_key: "SET", pairing: PAIRING, sent_at: new Date(NOW) }]]],
    ]);

    await sweepScheduleDeadlines(NOW);

    expect(executed(connection, /INSERT IGNORE/)).toHaveLength(0);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("sweepScheduleDeadlines_leaderWithoutRecipients_skipsThatSide", async () => {
    jest.mocked(loadEntrantMatchLeaderIds).mockResolvedValue(new Map([[100, [7]]]));
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await sweepScheduleDeadlines(NOW);

    expect(notifyUsers).toHaveBeenCalledTimes(1);
  });

  it("sweepScheduleDeadlines_dueToPlan_forfeitsAndAnnouncesForfeit", async () => {
    jest.mocked(forfeitMissedScheduleDeadlinePublic).mockResolvedValue(true);
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/SELECT match_id, notice_key/, () => [[{ match_id: 40, notice_key: "SET", pairing: PAIRING, sent_at: new Date(NOW) }]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);
    jest.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 1, lapsed: 0, reminded: 0 });

    expect(forfeitMissedScheduleDeadlinePublic).toHaveBeenCalledWith(10, 40, DEADLINE, DEADLINE + HOUR);
    expect(executed(connection, /INSERT IGNORE/)[0][1]).toEqual(["FORFEIT", PAIRING, new Date(DEADLINE + HOUR), 40, new Date(DEADLINE), 100, 200]);
    expect(notifyUsers).toHaveBeenCalledTimes(2);
  });

  it("sweepScheduleDeadlines_forfeitPreempted_nothingCounted", async () => {
    jest.mocked(forfeitMissedScheduleDeadlinePublic).mockResolvedValue(false);
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/SELECT match_id, notice_key/, () => [[{ match_id: 40, notice_key: "SET", pairing: PAIRING, sent_at: new Date(NOW) }]]],
    ]);

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 0, reminded: 0 });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("sweepScheduleDeadlines_lapse_clearsDeadlineAndNotices", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row({ team2_id: null })]]],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => [{ affectedRows: 1 }]],
    ]);

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 1, reminded: 0 });

    expect(executed(connection, /DELETE FROM bg_schedule_deadline_notices/)[0][1]).toEqual([40]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(10);
  });

  it("sweepScheduleDeadlines_lapseAlreadyChanged_nothingCounted", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row({ team2_id: null })]]],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => [{ affectedRows: 0 }]],
    ]);

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 0, reminded: 0 });
    expect(executed(connection, /DELETE FROM bg_schedule_deadline_notices/)).toHaveLength(0);
  });

  it("sweepScheduleDeadlines_readsPastDeadlinesOfScheduledMatches", async () => {
    routeSql(connection, []);

    await sweepScheduleDeadlines(NOW);

    const [sql, params] = executed(connection, /FROM bg_matches m/)[0];
    expect(sql).toContain("(m.start_at IS NULL OR m.schedule_deadline_at <= ?)");
    expect(params).toEqual([new Date(NOW)]);
  });

  it("sweepScheduleDeadlines_staleNotices_deletedBeforeClaimingAnnouncement", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/SELECT match_id, notice_key/, () => [[{ match_id: 40, notice_key: "SET", pairing: "100:300", sent_at: new Date(NOW - HOUR) }]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await expect(sweepScheduleDeadlines(NOW)).resolves.toEqual({ forfeited: 0, lapsed: 0, reminded: 1 });

    expect(executed(connection, /DELETE FROM bg_schedule_deadline_notices WHERE match_id = \? AND NOT/)[0][1]).toEqual([40, PAIRING]);
    expect(executed(connection, /INSERT IGNORE/)[0][1]).toEqual(["SET", PAIRING, new Date(NOW), 40, new Date(DEADLINE), 100, 200]);
  });

  it("sweepScheduleDeadlines_fourFailures_keepsDeadline", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => Promise.reject(new Error("panne"))],
    ]);

    for (let pass = 1; pass < SWEEP_MAX_FAILURES; pass += 1) await sweepScheduleDeadlines(NOW);

    expect(executed(connection, /UPDATE bg_matches SET schedule_deadline_at = NULL/)).toHaveLength(0);
  });

  it("sweepScheduleDeadlines_fifthConsecutiveFailure_lapsesDeadline", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => Promise.reject(new Error("panne"))],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => [{ affectedRows: 1 }]],
    ]);
    for (let pass = 1; pass < SWEEP_MAX_FAILURES; pass += 1) await sweepScheduleDeadlines(NOW);

    await expect(sweepScheduleDeadlines(NOW)).resolves.toEqual({ forfeited: 0, lapsed: 1, reminded: 0 });
    expect(executed(connection, /UPDATE bg_matches SET schedule_deadline_at = NULL/)[0][1]).toEqual([40, new Date(DEADLINE)]);
  });

  it("sweepScheduleDeadlines_rowFailure_otherRowsContinue", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row({ id: 41, team2_id: null, schedule_deadline_at: new Date(DEADLINE - 3 * HOUR) }), row()]]],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => Promise.reject(new Error("panne"))],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    // Le match 41 s'éteint (échec), le match 40 reçoit encore son rappel 3 h.
    await expect(sweepScheduleDeadlines(DEADLINE - 2 * HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 0, reminded: 1 });
    expect(error).toHaveBeenCalled();
  });
});

describe("setMatchScheduleDeadline", () => {
  beforeEach(() => {
    // Le balayage réveillé après l'écriture trouve le verrou pris : il n'interfère pas.
    jest.mocked(withNamedLock).mockRejectedValue(new NamedLockUnavailableError(SCHEDULE_DEADLINES_LOCK, 0));
  });

  const matchRoutes = (match: SweepRow | null): Route[] => [
    [/SELECT tournament_id FROM bg_matches/, () => [match ? [{ tournament_id: 10 }] : []]],
    [/FROM bg_tournaments/, () => [[{ referee_scheduling: 1, state: "RUNNING" }]]],
    [/FROM bg_matches WHERE id = \? LIMIT 1 FOR UPDATE/, () => [match ? [match] : []]],
  ];

  it("setMatchScheduleDeadline_invalidInput_throwsCodeWithoutDb", async () => {
    await expect(setMatchScheduleDeadline(40, "demain", ACTOR, NOW)).rejects.toThrow("INVALID_SCHEDULE_DEADLINE");
    expect(withConnection).not.toHaveBeenCalled();
  });

  it("setMatchScheduleDeadline_unknownMatch_throwsMatchNotFound", async () => {
    routeSql(connection, matchRoutes(null));

    await expect(setMatchScheduleDeadline(40, "2026-11-17T20:00:00Z", ACTOR, NOW)).rejects.toThrow("MATCH_NOT_FOUND");
  });

  it("setMatchScheduleDeadline_matchScheduled_throwsNotAllowedAndRollsBack", async () => {
    routeSql(connection, matchRoutes(row({ start_at: new Date(DEADLINE) })));

    await expect(setMatchScheduleDeadline(40, "2026-11-17T20:00:00Z", ACTOR, NOW)).rejects.toThrow("SCHEDULE_DEADLINE_NOT_ALLOWED");
    expect(connection.rollback).toHaveBeenCalled();
    expect(executed(connection, /UPDATE bg_matches/)).toHaveLength(0);
  });

  it("setMatchScheduleDeadline_valid_writesClearsNoticesAndAudits", async () => {
    routeSql(connection, matchRoutes(row({ schedule_deadline_at: null })));

    await expect(setMatchScheduleDeadline(40, "2026-11-17T20:00:00Z", ACTOR, NOW)).resolves.toBe("2026-11-17T20:00:00.000Z");

    expect(jest.mocked(lockTournamentRow).mock.invocationCallOrder[0]).toBeLessThan(
      connection.execute.mock.invocationCallOrder[connection.execute.mock.calls.findIndex(([sql]) => /bg_tournaments/.test(sql))],
    );
    expect(executed(connection, /UPDATE bg_matches SET schedule_deadline_at/)[0][1]).toEqual([new Date(DEADLINE), 40]);
    expect(executed(connection, /DELETE FROM bg_schedule_deadline_notices/)[0][1]).toEqual([40]);
    expect(connection.commit).toHaveBeenCalled();
    expect(auditStaffAction).toHaveBeenCalledWith(expect.stringContaining("match 40"), ACTOR);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(10);
  });

  it("setMatchScheduleDeadline_sameDeadline_noRewriteNoticesKept", async () => {
    routeSql(connection, matchRoutes(row()));

    await expect(setMatchScheduleDeadline(40, "2026-11-17T20:00:00Z", ACTOR, NOW)).resolves.toBe("2026-11-17T20:00:00.000Z");
    expect(executed(connection, /UPDATE bg_matches SET schedule_deadline_at/)).toHaveLength(0);
    expect(executed(connection, /DELETE FROM bg_schedule_deadline_notices/)).toHaveLength(0);
  });

  it("setMatchScheduleDeadline_clearOnScheduledMatch_allowed", async () => {
    routeSql(connection, matchRoutes(row({ start_at: new Date(DEADLINE) })));

    await expect(setMatchScheduleDeadline(40, null, ACTOR, NOW)).resolves.toBeNull();
    expect(executed(connection, /UPDATE bg_matches SET schedule_deadline_at/)[0][1]).toEqual([null, 40]);
  });
});

describe("setTournamentScheduleDeadlines", () => {
  beforeEach(() => {
    jest.mocked(withNamedLock).mockRejectedValue(new NamedLockUnavailableError(SCHEDULE_DEADLINES_LOCK, 0));
  });

  const rows = [
    row({ id: 40, schedule_deadline_at: null }),
    row({ id: 41, start_at: new Date(DEADLINE), schedule_deadline_at: null }),
    row({ id: 42, team2_id: null }),
  ];
  const tournamentRoutes = (refereeScheduling: number): Route[] => [
    [/FROM bg_tournaments/, () => [[{ referee_scheduling: refereeScheduling, state: "RUNNING" }]]],
    [/FROM bg_matches\s+WHERE tournament_id/, () => [rows]],
  ];
  const updatedIds = () => executed(connection, /UPDATE bg_matches SET schedule_deadline_at/).map(([, params]) => (params as unknown[])[1]);

  it("setTournamentScheduleDeadlines_optionOff_throwsNotAllowed", async () => {
    routeSql(connection, tournamentRoutes(0));

    await expect(setTournamentScheduleDeadlines(10, "2026-11-17T20:00:00Z", ACTOR, NOW)).rejects.toThrow("SCHEDULE_DEADLINE_NOT_ALLOWED");
  });

  it("setTournamentScheduleDeadlines_unknownTournament_throwsNotFound", async () => {
    routeSql(connection, []);

    await expect(setTournamentScheduleDeadlines(10, "2026-11-17T20:00:00Z", ACTOR, NOW)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("setTournamentScheduleDeadlines_valid_onlyToPlanMatchesWritten", async () => {
    routeSql(connection, tournamentRoutes(1));

    await expect(setTournamentScheduleDeadlines(10, "2026-11-17T20:00:00Z", ACTOR, NOW)).resolves.toBe(1);
    expect(updatedIds()).toEqual([40]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(10);
  });

  it("setTournamentScheduleDeadlines_sameDeadlineAlreadySet_notRewritten", async () => {
    routeSql(connection, [
      [/FROM bg_tournaments/, () => [[{ referee_scheduling: 1, state: "RUNNING" }]]],
      [/FROM bg_matches\s+WHERE tournament_id/, () => [[row({ id: 40 }), row({ id: 43, schedule_deadline_at: null })]]],
    ]);

    await expect(setTournamentScheduleDeadlines(10, "2026-11-17T20:00:00Z", ACTOR, NOW)).resolves.toBe(1);
    expect(updatedIds()).toEqual([43]);
    expect(executed(connection, /DELETE FROM bg_schedule_deadline_notices/).map(([, params]) => params)).toEqual([[43]]);
  });

  it("setTournamentScheduleDeadlines_clear_onlyMatchesWithDeadline", async () => {
    routeSql(connection, tournamentRoutes(1));

    await expect(setTournamentScheduleDeadlines(10, null, ACTOR, NOW)).resolves.toBe(1);
    expect(updatedIds()).toEqual([42]);
  });
});

