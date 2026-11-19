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
  SWEEP_BATCH,
  SEND_CONCURRENCY,
  SWEEP_FAILURE_BACKOFF_MS,
  SWEEP_LOOKAHEAD_MS,
  SWEEP_MAX_ACTIONS,
  SWEEP_MAX_FAILURES,
  SWEEP_MAX_PAGES,
  failureCounts,
  type SentNotices,
  setMatchScheduleDeadline,
  setTournamentScheduleDeadlines,
  sweepAction,
  sweepScheduleDeadlines,
  WRITE_CHUNK,
} from "@/lib/server/tournaments/schedule-deadline";
import type { RowColumns, RowOverrides } from "../../../helpers/row-overrides";
import { connectionMock, fakeConnection, fakePool, type SqlQuery } from "../../../helpers/sql-double";

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
  return { keys: new Set(keys), armedAt, stale: false, retired: false };
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

/** Paramètres de la lecture du balayage (hors mis de côté et reprise de page) à l'instant `now`. */
function sweepParams(now: number): unknown[] {
  return [new Date(now), "RETIRED", new Date(now), new Date(now + SWEEP_LOOKAHEAD_MS), "SET"];
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
  delete (globalThis as typeof globalThis & { __bgScheduleDeadlineFailures?: unknown }).__bgScheduleDeadlineFailures;
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

  it("sweepAction_scheduledPastDeadline_retire", () => {
    expect(sweepAction(row({ start_at: new Date(DEADLINE + 24 * HOUR) }), sentFor(["SET"]), DEADLINE)).toEqual({
      kind: "retire",
      deadlineAt: DEADLINE,
    });
  });

  it("sweepAction_launchedPastDeadline_retire", () => {
    const launched = row({ launched_at: new Date(NOW), launch_pairing: PAIRING });

    expect(sweepAction(launched, sentFor(["SET"]), DEADLINE)).toEqual({ kind: "retire", deadlineAt: DEADLINE });
  });

  it("sweepAction_scheduledPastDeadlineAlreadyRetired_none", () => {
    const retired: SentNotices = { ...sentFor(["SET"]), retired: true };

    expect(sweepAction(row({ start_at: new Date(DEADLINE + 24 * HOUR) }), retired, DEADLINE)).toEqual({ kind: "none" });
  });

  it("sweepAction_toPlanAgainAfterRetire_lapseNotForfeit", () => {
    // Horaire retiré après l'échéance : la date butoir retirée ne frappe plus.
    const retired: SentNotices = { ...sentFor(["SET"], DEADLINE - 2 * HOUR), retired: true };

    expect(sweepAction(row(), retired, DEADLINE + HOUR)).toEqual({ kind: "lapse", deadlineAt: DEADLINE });
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

    expect(sent.get(40)).toEqual({ keys: new Set(["DL24", "SET"]), armedAt: NOW, stale: false, retired: false });
  });

  it("sentNoticesByMatch_otherPairing_staleWithoutKeys", () => {
    const sent = sentNoticesByMatch([row()], [notice("SET", "100:300", NOW)]);

    expect(sent.get(40)).toEqual({ keys: new Set(), armedAt: null, stale: true, retired: false });
  });

  it("sentNoticesByMatch_retiredMarkerOtherPairing_retiredWithoutArming", () => {
    const sent = sentNoticesByMatch([row()], [notice("RETIRED", "100:300", NOW)]);

    expect(sent.get(40)).toEqual({ keys: new Set(), armedAt: null, stale: false, retired: true });
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
      [/SELECT notice_key, pairing, sent_at/, () => [[{ notice_key: "SET", pairing: PAIRING, sent_at: new Date(NOW) }]]],
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
      [/SELECT notice_key, pairing, sent_at/, () => [[]]],
    ]);

    await expect(run()).resolves.toBe(false);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("forfeitMissedScheduleDeadline_retiredMarker_false", async () => {
    routeSql(connection, [
      [/FROM bg_tournaments/, () => tournament("RUNNING")],
      [/FROM bg_matches/, () => [[row()]]],
      [
        /SELECT notice_key, pairing, sent_at/,
        () => [
          [
            { notice_key: "SET", pairing: PAIRING, sent_at: new Date(NOW) },
            { notice_key: "RETIRED", pairing: PAIRING, sent_at: new Date(DEADLINE) },
          ],
        ],
      ],
    ]);

    await expect(run()).resolves.toBe(false);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("forfeitMissedScheduleDeadline_noticesOfPreviousPairingOnly_false", async () => {
    routeSql(connection, [
      [/FROM bg_tournaments/, () => tournament("RUNNING")],
      [/FROM bg_matches/, () => [[row()]]],
      [/SELECT notice_key, pairing, sent_at/, () => [[{ notice_key: "SET", pairing: "100:300", sent_at: new Date(NOW) }]]],
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

    await expect(sweepScheduleDeadlines(NOW)).resolves.toEqual({ forfeited: 0, lapsed: 0, retired: 0, reminded: 0 });
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("sweepScheduleDeadlines_announcementClaimed_sendsOncePerSideToMatchLeaders", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await expect(sweepScheduleDeadlines(NOW)).resolves.toEqual({ forfeited: 0, lapsed: 0, retired: 0, reminded: 1 });

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

    await expect(sweepScheduleDeadlines(NOW)).resolves.toEqual({ forfeited: 0, lapsed: 0, retired: 0, reminded: 0 });
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

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 1, lapsed: 0, retired: 0, reminded: 0 });

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

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 0, retired: 0, reminded: 0 });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("sweepScheduleDeadlines_lapse_clearsDeadlineAndNotices", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row({ team2_id: null })]]],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => [{ affectedRows: 1 }]],
    ]);

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 1, retired: 0, reminded: 0 });

    expect(executed(connection, /DELETE FROM bg_schedule_deadline_notices/)[0][1]).toEqual([40]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(10);
  });

  it("sweepScheduleDeadlines_lapseAlreadyChanged_nothingCounted", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row({ team2_id: null })]]],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => [{ affectedRows: 0 }]],
    ]);

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 0, retired: 0, reminded: 0 });
    expect(executed(connection, /DELETE FROM bg_schedule_deadline_notices/)).toHaveLength(0);
  });

  it("sweepScheduleDeadlines_readsPastDeadlinesOfScheduledMatches", async () => {
    routeSql(connection, []);

    await sweepScheduleDeadlines(NOW);

    const [sql, params] = executed(connection, /FROM bg_matches m/)[0];
    expect(sql).toContain("(m.start_at IS NULL OR m.schedule_deadline_at <= ?)");
    expect(params).toEqual(sweepParams(NOW));
  });

  it("sweepScheduleDeadlines_scheduledPastDeadline_marksRetiredAndKeepsDeadline", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row({ start_at: new Date(DEADLINE + 24 * HOUR) })]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 0, retired: 1, reminded: 0 });

    expect(executed(connection, /INSERT IGNORE/)[0][1]).toEqual(["RETIRED", PAIRING, new Date(DEADLINE + HOUR), 40, new Date(DEADLINE), PAIRING]);
    expect(executed(connection, /UPDATE bg_matches SET schedule_deadline_at = NULL/)).toHaveLength(0);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("sweepScheduleDeadlines_fullPage_readsNextPageAfterLastRow", async () => {
    const page = Array.from({ length: SWEEP_BATCH }, (_, index) => row({ id: 1000 + index, team2_id: null }));
    let reads = 0;
    routeSql(connection, [
      [/FROM bg_matches m/, () => [(reads += 1) === 1 ? page : []]],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => [{ affectedRows: 0 }]],
    ]);

    await sweepScheduleDeadlines(DEADLINE + HOUR);

    const pages = executed(connection, /FROM bg_matches m/);
    expect(pages).toHaveLength(2);
    expect(pages[1][1]).toEqual([...sweepParams(DEADLINE + HOUR), new Date(DEADLINE), new Date(DEADLINE), 1000 + SWEEP_BATCH - 1]);
  });

  it("sweepScheduleDeadlines_staleNotices_deletedBeforeClaimingAnnouncement", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/SELECT match_id, notice_key/, () => [[{ match_id: 40, notice_key: "SET", pairing: "100:300", sent_at: new Date(NOW - HOUR) }]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await expect(sweepScheduleDeadlines(NOW)).resolves.toEqual({ forfeited: 0, lapsed: 0, retired: 0, reminded: 1 });

    const [deleteSql, deleteParams] = executed(connection, /DELETE FROM bg_schedule_deadline_notices WHERE match_id = \? AND NOT/)[0];
    expect(deleteSql).toContain("notice_key <> ?");
    expect(deleteParams).toEqual([40, PAIRING, "RETIRED"]);
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

  it("sweepScheduleDeadlines_fifthConsecutiveFailure_parksMatchWithoutLapsing", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => Promise.reject(new Error("panne"))],
    ]);
    for (let pass = 1; pass <= SWEEP_MAX_FAILURES; pass += 1) await sweepScheduleDeadlines(NOW);

    await sweepScheduleDeadlines(NOW + MINUTE);

    expect(executed(connection, /UPDATE bg_matches SET schedule_deadline_at = NULL/)).toHaveLength(0);
    const last = executed(connection, /FROM bg_matches m/).at(-1);
    expect(last?.[0]).toContain("m.id NOT IN (?)");
    expect(last?.[1]).toEqual([...sweepParams(NOW + MINUTE), 40]);
  });

  it("sweepScheduleDeadlines_backoffElapsed_matchReadAgain", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => Promise.reject(new Error("panne"))],
    ]);
    for (let pass = 1; pass <= SWEEP_MAX_FAILURES; pass += 1) await sweepScheduleDeadlines(NOW);

    await sweepScheduleDeadlines(NOW + SWEEP_FAILURE_BACKOFF_MS);

    expect(executed(connection, /FROM bg_matches m/).at(-1)?.[0]).not.toContain("m.id NOT IN");
  });

  it("sweepScheduleDeadlines_failedMatchNoLongerRead_failureForgotten", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    let present = true;
    routeSql(connection, [
      [/FROM bg_matches m/, () => [present ? [row()] : []]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => Promise.reject(new Error("panne"))],
    ]);
    for (let pass = 1; pass < SWEEP_MAX_FAILURES; pass += 1) await sweepScheduleDeadlines(NOW);
    present = false;
    await sweepScheduleDeadlines(NOW);
    present = true;

    // Un seul nouvel échec après l'oubli : pas de mise de côté.
    await sweepScheduleDeadlines(NOW);
    await sweepScheduleDeadlines(NOW);

    expect(executed(connection, /FROM bg_matches m/).at(-1)?.[0]).not.toContain("m.id NOT IN");
  });

  it("sweepScheduleDeadlines_deadlineChangedAfterFailures_countRestarts", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    let deadline = DEADLINE;
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row({ schedule_deadline_at: new Date(deadline) })]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => Promise.reject(new Error("panne"))],
    ]);
    for (let pass = 1; pass < SWEEP_MAX_FAILURES; pass += 1) await sweepScheduleDeadlines(NOW);
    deadline = DEADLINE + 24 * HOUR;

    await sweepScheduleDeadlines(NOW);
    await sweepScheduleDeadlines(NOW);

    expect(executed(connection, /FROM bg_matches m/).at(-1)?.[0]).not.toContain("m.id NOT IN");
  });

  it("sweepScheduleDeadlines_rowFailure_otherRowsContinue", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row({ id: 41, team2_id: null, schedule_deadline_at: new Date(DEADLINE - 3 * HOUR) }), row()]]],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => Promise.reject(new Error("panne"))],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    // Le match 41 s'éteint (échec), le match 40 reçoit encore son rappel 3 h.
    await expect(sweepScheduleDeadlines(DEADLINE - 2 * HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 0, retired: 0, reminded: 1 });
    expect(error).toHaveBeenCalled();
  });
  it("sweepScheduleDeadlines_retireAfterScheduleRemoved_guardRequiresSchedule", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row({ start_at: new Date(DEADLINE + 24 * HOUR) })]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(0)],
    ]);

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 0, retired: 0, reminded: 0 });

    expect(executed(connection, /INSERT IGNORE/)[0][0]).toContain("(start_at IS NOT NULL OR (launched_at IS NOT NULL AND launch_pairing <=> ?))");
  });

  it("sweepScheduleDeadlines_retireRefusedThenScheduleGone_nextPassLapses", async () => {
    let scheduled = true;
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row({ start_at: scheduled ? new Date(DEADLINE + 24 * HOUR) : null })]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(0)],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => [{ affectedRows: 1 }]],
    ]);
    // Horaire retiré entre la lecture et l'écriture : la garde refuse la marque.
    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toEqual({ forfeited: 0, lapsed: 0, retired: 0, reminded: 0 });
    scheduled = false;

    // Relu à planifier, jamais prévenu : la date butoir s'éteint, sans forfait.
    await expect(sweepScheduleDeadlines(DEADLINE + HOUR + MINUTE)).resolves.toEqual({ forfeited: 0, lapsed: 1, retired: 0, reminded: 0 });
  });

  it("sweepScheduleDeadlines_actionCapReached_stopsPassWithoutForgettingFailures", async () => {
    failureCounts().set(9999, { deadlineAt: DEADLINE, failures: 2, retryAt: 0 });
    const page = Array.from({ length: SWEEP_MAX_ACTIONS + 5 }, (_, index) => row({ id: 1000 + index, team2_id: null }));
    routeSql(connection, [
      [/FROM bg_matches m/, () => [page]],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => [{ affectedRows: 1 }]],
    ]);

    await expect(sweepScheduleDeadlines(DEADLINE + HOUR)).resolves.toMatchObject({ lapsed: SWEEP_MAX_ACTIONS });

    expect(executed(connection, /FROM bg_matches m/)).toHaveLength(1);
    expect(failureCounts().has(9999)).toBe(true);
  });

  it("sweepScheduleDeadlines_maxPagesReached_failureTableKept", async () => {
    failureCounts().set(9999, { deadlineAt: DEADLINE, failures: 2, retryAt: 0 });
    let reads = 0;
    routeSql(connection, [
      [
        /FROM bg_matches m/,
        () => {
          reads += 1;
          return [Array.from({ length: SWEEP_BATCH }, (_, index) => row({ id: reads * 10000 + index, team2_id: null }))];
        },
      ],
      [/UPDATE bg_matches SET schedule_deadline_at = NULL/, () => [{ affectedRows: 0 }]],
    ]);

    await sweepScheduleDeadlines(DEADLINE + HOUR);

    expect(executed(connection, /FROM bg_matches m/)).toHaveLength(SWEEP_MAX_PAGES);
    expect(failureCounts().has(9999)).toBe(true);
  });

  it("sweepScheduleDeadlines_equalDeadlines_cursorKeepsDeadlineAndId", async () => {
    let reads = 0;
    const page = Array.from({ length: SWEEP_BATCH }, (_, index) => row({ id: 1000 + index, team2_id: null }));
    routeSql(connection, [[/FROM bg_matches m/, () => [(reads += 1) === 1 ? page : []]]]);

    await sweepScheduleDeadlines(DEADLINE + HOUR);

    expect(executed(connection, /FROM bg_matches m/)[1][0]).toContain("m.schedule_deadline_at = ? AND m.id > ?");
  });

  it("sweepScheduleDeadlines_failureAfterBackoff_startsNewSeries", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => Promise.reject(new Error("panne"))],
    ]);
    for (let pass = 1; pass <= SWEEP_MAX_FAILURES; pass += 1) await sweepScheduleDeadlines(NOW);

    await sweepScheduleDeadlines(NOW + SWEEP_FAILURE_BACKOFF_MS);

    expect(failureCounts().get(40)).toEqual({ deadlineAt: DEADLINE, failures: 1, retryAt: 0 });
    expect(String(error.mock.calls.at(-1)?.[0])).toContain("(1/" + SWEEP_MAX_FAILURES + ")");
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

    // Les deux matchs visés portent la date butoir : le compte les dit tous deux.
    await expect(setTournamentScheduleDeadlines(10, "2026-11-17T20:00:00Z", ACTOR, NOW)).resolves.toBe(2);
    expect(updatedIds()).toEqual([43]);
    expect(executed(connection, /DELETE FROM bg_schedule_deadline_notices/).map(([, params]) => params)).toEqual([[43]]);
  });

  it("setTournamentScheduleDeadlines_allAlreadySet_returnsTargetedCountWithoutEvent", async () => {
    routeSql(connection, [
      [/FROM bg_tournaments/, () => [[{ referee_scheduling: 1, state: "RUNNING" }]]],
      [/FROM bg_matches\s+WHERE tournament_id/, () => [[row({ id: 40 }), row({ id: 43 })]]],
    ]);

    await expect(setTournamentScheduleDeadlines(10, "2026-11-17T20:00:00Z", ACTOR, NOW)).resolves.toBe(2);
    expect(updatedIds()).toEqual([]);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("setTournamentScheduleDeadlines_clear_onlyToPlanMatchesWithDeadline", async () => {
    routeSql(connection, [
      [/FROM bg_tournaments/, () => [[{ referee_scheduling: 1, state: "RUNNING" }]]],
      [
        /FROM bg_matches\s+WHERE tournament_id/,
        () => [
          [
            row({ id: 40 }),
            row({ id: 41, start_at: new Date(DEADLINE) }),
            row({ id: 42, team2_id: null }),
            row({ id: 43, launched_at: new Date(DEADLINE), launch_pairing: PAIRING }),
          ],
        ],
      ],
    ]);

    // Seul le match à planifier perd sa date butoir : celle d'un match programmé ou lancé
    // (retirée, lue par le planning) et celle d'une manche pas remplie restent.
    await expect(setTournamentScheduleDeadlines(10, null, ACTOR, NOW)).resolves.toBe(1);
    expect(updatedIds()).toEqual([40]);
  });
});

describe("sweepScheduleDeadlines : coût du passage", () => {
  const claimed = (affectedRows: number) => [{ affectedRows }];
  let lockHeld: boolean;

  beforeEach(() => {
    lockHeld = false;
    jest.mocked(withNamedLock).mockImplementation(async (_db, _name, _timeout, run) => {
      lockHeld = true;
      try {
        return await run(fakeConnection(connection));
      } finally {
        lockHeld = false;
      }
    });
  });

  it("sweepScheduleDeadlines_read_skipsFutureRowsNothingWaitsFor", async () => {
    routeSql(connection, []);

    await sweepScheduleDeadlines(NOW);

    const [sql] = executed(connection, /FROM bg_matches m/)[0];
    expect(SWEEP_LOOKAHEAD_MS).toBe(24 * HOUR);
    expect(sql).toContain("m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL AND t.referee_scheduling = 1");
    expect(sql).toContain("a.pairing = CONCAT(m.team1_id, ':', m.team2_id)");
    expect(sql).toContain("t.state = 'FINISHED'");
  });

  it("sweepScheduleDeadlines_announcement_sentAfterNamedLockReleased", async () => {
    const heldDuringSend: boolean[] = [];
    jest.mocked(notifyUsers).mockImplementation(async () => {
      heldDuringSend.push(lockHeld);
      return { discord: null, discordUnreachedUserIds: [], pushed: 0 };
    });
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await sweepScheduleDeadlines(NOW);

    expect(heldDuringSend).toEqual([false, false]);
  });

  it("sweepScheduleDeadlines_sends_atMostConcurrencyMatchesAtOnce", async () => {
    let running = 0;
    let peak = 0;
    jest.mocked(notifyUsers).mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return { discord: null, discordUnreachedUserIds: [], pushed: 0 };
    });
    const rows = Array.from({ length: SEND_CONCURRENCY * 3 }, (_, index) => row({ id: 500 + index }));
    routeSql(connection, [
      [/FROM bg_matches m/, () => [rows]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await sweepScheduleDeadlines(NOW);

    expect(notifyUsers).toHaveBeenCalledTimes(rows.length * 2);
    expect(peak).toBeLessThanOrEqual(SEND_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it("sweepScheduleDeadlines_sendFails_releasesClaimAndCountsFailure", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadEntrantMatchLeaderIds).mockRejectedValue(new Error("bot"));
    const pool = { execute: jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]) };
    jest.mocked(getDatabase).mockResolvedValue(fakePool(pool));
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await expect(sweepScheduleDeadlines(NOW)).resolves.toMatchObject({ reminded: 1 });

    const released = pool.execute.mock.calls.filter(([sql]) => /DELETE FROM bg_schedule_deadline_notices/.test(String(sql)));
    expect(released).toHaveLength(1);
    expect(released[0][1]).toEqual([40, PAIRING, "SET"]);
    expect(failureCounts().get(40)?.failures).toBe(1);
  });

  it("sweepScheduleDeadlines_sendFailsAfterFirstSideDelivered_keepsClaim", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(notifyUsers).mockResolvedValueOnce({ discord: null, discordUnreachedUserIds: [], pushed: 0 });
    jest.mocked(notifyUsers).mockRejectedValueOnce(new Error("bot"));
    const pool = { execute: jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }]) };
    jest.mocked(getDatabase).mockResolvedValue(fakePool(pool));
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await sweepScheduleDeadlines(NOW);

    expect(pool.execute.mock.calls.filter(([sql]) => /DELETE/.test(String(sql)))).toHaveLength(0);
    expect(failureCounts().get(40)?.failures).toBe(1);
  });

  it("sweepScheduleDeadlines_forfeitNoticeFails_loggedWithoutFailureCount", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.mocked(forfeitMissedScheduleDeadlinePublic).mockResolvedValue(true);
    jest.mocked(loadEntrantMatchLeaderIds).mockRejectedValue(new Error("bot"));
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/SELECT match_id, notice_key/, () => [[{ match_id: 40, notice_key: "SET", pairing: PAIRING, sent_at: new Date(DEADLINE - HOUR) }]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await expect(sweepScheduleDeadlines(DEADLINE)).resolves.toMatchObject({ forfeited: 1 });

    expect(failureCounts().has(40)).toBe(false);
    expect(error.mock.calls.some(([message]) => String(message).includes("avis de forfait non envoyé"))).toBe(true);
  });

  it("sweepScheduleDeadlines_staleNotices_deleteAndClaimInOneTransaction", async () => {
    routeSql(connection, [
      [/FROM bg_matches m/, () => [[row()]]],
      [/SELECT match_id, notice_key/, () => [[{ match_id: 40, notice_key: "SET", pairing: "100:300", sent_at: new Date(NOW - HOUR) }]]],
      [/INSERT IGNORE INTO bg_schedule_deadline_notices/, () => claimed(1)],
    ]);

    await sweepScheduleDeadlines(NOW);

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    const sqls = connection.execute.mock.calls.map(([sql]) => String(sql));
    const order = connection.execute.mock.invocationCallOrder;
    const deleteAt = order[sqls.findIndex((sql) => /DELETE FROM bg_schedule_deadline_notices/.test(sql))];
    const insertAt = order[sqls.findIndex((sql) => /INSERT IGNORE/.test(sql))];
    expect(connection.beginTransaction.mock.invocationCallOrder[0]).toBeLessThan(deleteAt);
    expect(insertAt).toBeLessThan(connection.commit.mock.invocationCallOrder[0]);
  });

  it("sweepScheduleDeadlines_pagesExhaustedWithoutEnd_warnsSaturation", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    let reads = 0;
    const page = () => {
      reads += 1;
      return Array.from({ length: SWEEP_BATCH }, (_, index) =>
        row({ id: 1000 + reads * SWEEP_BATCH + index, schedule_deadline_at: new Date(DEADLINE + 40 * HOUR) }),
      );
    };
    routeSql(connection, [[/FROM bg_matches m/, () => [page()]]]);

    await sweepScheduleDeadlines(NOW);

    expect(executed(connection, /FROM bg_matches m/)).toHaveLength(SWEEP_MAX_PAGES);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("saturé");
  });

  it("sweepScheduleDeadlines_completeRead_noSaturationWarning", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    routeSql(connection, []);

    await sweepScheduleDeadlines(NOW);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("setTournamentScheduleDeadlines : écritures groupées", () => {
  beforeEach(() => {
    jest.mocked(withNamedLock).mockRejectedValue(new NamedLockUnavailableError(SCHEDULE_DEADLINES_LOCK, 0));
  });

  it("setTournamentScheduleDeadlines_manyMatches_writtenPerChunkNotPerMatch", async () => {
    const rows = Array.from({ length: WRITE_CHUNK * 2 + 5 }, (_, index) => row({ id: 2000 + index, schedule_deadline_at: null }));
    routeSql(connection, [
      [/FROM bg_tournaments/, () => [[{ referee_scheduling: 1, state: "RUNNING" }]]],
      [/FROM bg_matches\s+WHERE tournament_id/, () => [rows]],
    ]);

    await expect(setTournamentScheduleDeadlines(10, "2026-11-17T20:00:00Z", ACTOR, NOW)).resolves.toBe(rows.length);

    const updates = executed(connection, /UPDATE bg_matches SET schedule_deadline_at/);
    const deletes = executed(connection, /DELETE FROM bg_schedule_deadline_notices/);
    expect(updates).toHaveLength(3);
    expect(deletes).toHaveLength(3);
    expect(updates.flatMap(([, params]) => (params as unknown[]).slice(1))).toHaveLength(rows.length);
    expect(updates[0][0]).toContain("WHERE id IN (");
  });
});
