import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.unmock("@/lib/server/tournaments/new-match-notices");
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/site-url", () => ({
  siteUrl: (path: string) => `https://bluegenji.test${path}`,
}));

import { getDatabase } from "@/lib/server/database";
import { loadEntrantPlayerIds, loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import {
  dispatchNewMatchNotices,
  resetNewMatchNoticeThrottle,
} from "@/lib/server/tournaments/new-match-notices";
import { newMatchPendingSql, newMatchToldSql, setNewMatchNoticesAvailable } from "@/lib/server/tournaments/new-match-sql";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";

const MATCH = {
  id: 40,
  tournament_id: 4,
  bracket: "UPPER",
  round_number: 2,
  team1_id: 1,
  team2_id: 2,
  start_at: null,
  tournament_name: "Coupe",
  participant_type: "TEAM",
  swiss_round: 0,
  team1_name: "Renards",
  team2_name: "Nova",
  team1_ghost: 0,
  team2_ghost: 0,
  team1_deleted: 0,
  team2_deleted: 0,
};

/** Écritures simulées qui aboutissent toujours (une ligne touchée). */
const WRITES_THAT_SUCCEED = [
  "INSERT IGNORE INTO bg_settings",
  "INSERT INTO bg_settings",
  "DELETE FROM bg_new_match_notices",
  "DELETE FROM bg_match_reminders",
];

const PLACE = { tournament_id: 4, phase_id: 1, bracket: "UPPER", round_number: 2, match_number: 1, pairing: "1:2", team_low_id: 1, team_high_id: 2 };

type Db = { execute: jest.Mock<SqlQuery>; query: jest.Mock<SqlQuery> };

/**
 * Base simulée : `installed` = clé de mise en service déjà posée ;
 * `candidates` = matchs à annoncer ; `claims` = issue de chaque relecture du
 * match (réservation puis contrôle) ; `inserted` = issue de l'insertion.
 */
function mockDb(
  options: { installed?: boolean; candidates?: object[]; claims?: boolean[]; inserted?: boolean; marksTaken?: number } = {},
): Db {
  const claims = [...(options.claims ?? [])];
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.startsWith("SELECT 1 FROM bg_settings")) return [options.installed === false ? [] : [{ 1: 1 }]];
    if (WRITES_THAT_SUCCEED.some((prefix) => sql.trim().startsWith(prefix))) return [{ affectedRows: 1 }];
    if (sql.startsWith("SELECT m.tournament_id")) {
      const claimed = claims.length > 0 ? claims.shift() : true;
      return [claimed ? [PLACE] : []];
    }
    if (sql.trim().startsWith("INSERT IGNORE INTO bg_new_match_notices")) {
      return [{ affectedRows: options.inserted === false ? 0 : 1 }];
    }
    throw new Error(`requête inattendue : ${sql}`);
  });
  const query = jest.fn<SqlQuery>(async (sql, params) => {
    if (sql.trim().startsWith("INSERT IGNORE INTO bg_match_reminders")) {
      return [{ affectedRows: options.marksTaken ?? (params as unknown[]).length / 3 }];
    }
    if (sql.startsWith("SELECT m.tournament_id")) return [[PLACE, { ...PLACE, match_number: 2 }]];
    if (sql.trim().startsWith("INSERT IGNORE INTO bg_new_match_notices")) return [{ affectedRows: 2 }];
    return [options.candidates ?? []];
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, query }));
  return { execute, query };
}

function reminderMarks(db: Db): unknown[] {
  return db.query.mock.calls
    .filter(([sql]) => sql.trim().startsWith("INSERT IGNORE INTO bg_match_reminders"))
    .flatMap(([, params]) => (params as unknown[]).filter((_, index) => index % 3 === 1));
}

function recipient(userId: number, discord = true) {
  return { userId, discord: discord ? { discordId: `d${userId}`, handle: null, label: `p${userId}` } : null };
}

function claimCalls(db: Db) {
  return db.execute.mock.calls.filter(
    ([sql]) => sql.startsWith("SELECT m.tournament_id"),
  );
}

const SENT = { discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 1 };

beforeEach(() => {
  resetNewMatchNoticeThrottle();
  jest.mocked(loadEntrantPlayerIds).mockResolvedValue(
    new Map([
      [1, [11, 12]],
      [2, [21]],
    ]),
  );
  jest.mocked(loadNotificationRecipients).mockResolvedValue([recipient(11), recipient(12), recipient(21)]);
  jest.mocked(notifyUsers).mockResolvedValue(SENT);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("dispatchNewMatchNotices", () => {
  it("installNewMatchNotices_firstRun_marksPairedMatchesSkippedThenSetsKey", async () => {
    const db = mockDb({ installed: false });

    await dispatchNewMatchNotices();

    const skipIndex = db.query.mock.calls.findIndex(([sql]) => sql.trim().startsWith("INSERT IGNORE INTO bg_new_match_notices"));
    const keyIndex = db.execute.mock.calls.findIndex(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_settings"));
    expect(skipIndex).toBeGreaterThan(-1);
    expect(db.execute.mock.invocationCallOrder[keyIndex]).toBeGreaterThan(db.query.mock.invocationCallOrder[skipIndex]);
  });

  it("installNewMatchNotices_alreadyInstalled_marksNothing", async () => {
    const db = mockDb({ candidates: [] });

    await dispatchNewMatchNotices();

    expect(db.query.mock.calls.some(([sql]) => sql.trim().startsWith("INSERT IGNORE INTO bg_new_match_notices"))).toBe(false);
  });

  it("dispatch_firstRoundMatch_isAnnounced", async () => {
    mockDb({ candidates: [{ ...MATCH, round_number: 1 }] });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(2);
  });

  it("dispatch_unscheduledMatch_setsNoReminderMarks", async () => {
    const db = mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    expect(reminderMarks(db)).toEqual([]);
  });

  it("dispatch_scheduledMatch_marksSeenAndToldBeforeClaimSoNoMatchScheduled", async () => {
    const db = mockDb({ candidates: [{ ...MATCH, start_at: new Date(Date.now() + 3 * 24 * 3600 * 1000) }] });

    await dispatchNewMatchNotices();

    expect(reminderMarks(db)).toEqual(["SEEN", "TOLD"]);
    const marks = db.query.mock.calls.findIndex(([sql]) => sql.trim().startsWith("INSERT IGNORE INTO bg_match_reminders"));
    const claim = db.execute.mock.calls.findIndex(([sql]) => sql.trim().startsWith("INSERT IGNORE INTO bg_new_match_notices"));
    expect(db.query.mock.invocationCallOrder[marks]).toBeLessThan(db.execute.mock.invocationCallOrder[claim]);
  });

  it("dispatch_scheduledWithinReminderWindow_consumesOpenedReminders", async () => {
    const db = mockDb({ candidates: [{ ...MATCH, start_at: new Date(Date.now() + 5 * 3600 * 1000) }] });

    await dispatchNewMatchNotices();

    expect(reminderMarks(db)).toEqual(expect.arrayContaining(["SEEN", "TOLD", "P1D"]));
  });

  it("dispatch_scheduledMatch_pushCarriesTheTime", async () => {
    mockDb({ candidates: [{ ...MATCH, start_at: new Date("2099-11-14T19:00:00.000Z") }] });

    await dispatchNewMatchNotices();

    expect(resolvePush(jest.mocked(notifyUsers).mock.calls[0][1].push).body).toContain("Coup d'envoi");
  });

  it("dispatch_pastStartNotLaunched_stillAnnounceable", async () => {
    const db = mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    expect(db.query.mock.calls[0][0]).not.toContain("m.start_at > NOW()");
  });

  it("dispatch_dm_endsWithOptOutLink", async () => {
    mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    const message = jest.mocked(notifyUsers).mock.calls[0][1].discord?.message("fr") ?? "";
    expect(message).toContain("<https://bluegenji.test/profil#notifications>");
  });

  it("dispatch_noCandidates_sendsNothing", async () => {
    mockDb();

    await dispatchNewMatchNotices();

    expect(loadEntrantPlayerIds).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("dispatch_candidate_notifiesBothTeamsWithTopicDmAndMatchLink", async () => {
    mockDb({ candidates: [MATCH] });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(2);
    expect(notifyUsers).toHaveBeenCalledTimes(2);
    const [recipients, notification] = jest.mocked(notifyUsers).mock.calls[0];
    expect(recipients.map((r) => r.userId)).toEqual([11, 12]);
    expect(notification.topic).toBe("NEW_MATCH");
    expect(notification.discord?.context).toBe("new-match");
    expect(notification.discord?.message("fr")).toContain("Ton équipe « Renards » affronte « Nova ».");
    expect(notification.discord?.message("fr")).toContain("https://bluegenji.test/tournois/4/matchs/40");
    expect(resolvePush(notification.push).url).toBe("/tournois/4/matchs/40");
    expect(resolvePush(notification.push, "en").url).toBe("/en/tournois/4/matchs/40");
  });

  it("dispatch_secondSide_seesTeamAndOpponentSwapped", async () => {
    mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    const [recipients, notification] = jest.mocked(notifyUsers).mock.calls[1];
    expect(recipients.map((r) => r.userId)).toEqual([21]);
    expect(notification.discord?.message("en")).toContain("Your team “Nova” faces “Renards”.");
  });

  it("dispatch_claimLost_sendsNothing", async () => {
    mockDb({ candidates: [MATCH], claims: [false] });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(0);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("claimNewMatchNotice_reservation_rereadsMatchWithItsEntrantsInOneStatement", async () => {
    const db = mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    const [sql, params] = claimCalls(db)[0];
    expect(sql).not.toContain("INSERT");
    expect(sql).toContain("LEAST(m.team1_id, m.team2_id)");
    expect(sql).toContain("m.launched_at IS NULL");
    expect(sql).toContain("JOIN bg_teams t1 ON t1.id = m.team1_id");
    expect(sql).toContain("m.start_at <=> ?");
    expect(params).toEqual([40, 1, 2, null, 0, 0]);
  });

  it("dispatch_scheduledWithinCheckInWindow_leavesCheckInReminderToTheSweep", async () => {
    const db = mockDb({ candidates: [{ ...MATCH, start_at: new Date(Date.now() + 5 * 3600 * 1000) }] });

    await dispatchNewMatchNotices();

    expect(reminderMarks(db)).not.toContain("PT10H");
  });

  it("dispatch_markClaimThrows_continuesWithNextMatch", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const db = mockDb({
      candidates: [
        { ...MATCH, start_at: new Date(Date.now() + 3 * 24 * 3600 * 1000) },
        { ...MATCH, id: 41, team1_id: 3, team2_id: 4 },
      ],
    });
    const fallback = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      if (sql.trim().startsWith("INSERT IGNORE INTO bg_match_reminders")) throw new Error("disque plein");
      return fallback!(sql, params);
    });

    await dispatchNewMatchNotices();

    expect(claimCalls(db).map(([, params]) => (params as unknown[])[0])).toEqual([41, 41]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("annonce en échec (match 40"), expect.anything());
    error.mockRestore();
  });

  it("dispatch_recipients_loadedPerMatchForItsTwoEntrants", async () => {
    mockDb({ candidates: [MATCH, { ...MATCH, id: 41, team1_id: 3, team2_id: 4 }] });

    await dispatchNewMatchNotices();

    expect(loadEntrantPlayerIds).toHaveBeenCalledWith([1, 2]);
    expect(loadEntrantPlayerIds).toHaveBeenCalledWith([3, 4]);
  });

  it("installNewMatchNotices_firstRun_insertsSkipValuesWithoutInsertSelect", async () => {
    const db = mockDb({ installed: false });

    await dispatchNewMatchNotices();

    const [sql, params] =
      db.query.mock.calls.find(([text]) => text.trim().startsWith("INSERT IGNORE INTO bg_new_match_notices")) ?? [];
    expect(sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1), (?, ?, ?, ?, ?, ?, ?, ?, 1)");
    expect(sql).not.toContain("SELECT");
    expect(params).toEqual([4, 1, "UPPER", 2, 1, "1:2", 1, 2, 4, 1, "UPPER", 2, 2, "1:2", 1, 2]);
  });

  it("claimNewMatchNotice_claimed_insertsPlaceWithAnnouncedStartAt", async () => {
    const startAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const db = mockDb({ candidates: [{ ...MATCH, start_at: startAt }] });

    await dispatchNewMatchNotices();

    const [, params] =
      db.execute.mock.calls.find(([sql]) => sql.trim().startsWith("INSERT IGNORE INTO bg_new_match_notices")) ?? [];
    expect(params).toEqual([4, 1, "UPPER", 2, 1, "1:2", 1, 2, startAt]);
  });

  it("dispatch_claimLostOnScheduledMatch_releasesTheReminderMarksItTook", async () => {
    const startAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const db = mockDb({ candidates: [{ ...MATCH, start_at: startAt }], claims: [false] });

    await dispatchNewMatchNotices();

    const [, params] = db.execute.mock.calls.find(([sql]) => sql.startsWith("DELETE FROM bg_match_reminders")) ?? [];
    expect(params).toEqual([40, "SEEN", "TOLD", startAt]);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("dispatch_someDmsUnreached_logsCountOnly", async () => {
    jest.mocked(notifyUsers).mockResolvedValue({ ...SENT, discordUnreachedUserIds: [12] });
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    expect(error).toHaveBeenCalledWith(expect.stringContaining("1 message(s) privé(s) perdu(s) (match 40)"));
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("12"));
    error.mockRestore();
  });

  it("dispatch_ghostSide_skipsGhost", async () => {
    mockDb({ candidates: [{ ...MATCH, team2_ghost: 1 }] });

    await dispatchNewMatchNotices();

    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(jest.mocked(notifyUsers).mock.calls[0][0].map((r) => r.userId)).toEqual([11, 12]);
  });

  it("dispatch_sideWithoutLoadedRecipients_skipsSide", async () => {
    // Comptes supprimés : `loadNotificationRecipients` ne les rend pas.
    jest.mocked(loadNotificationRecipients).mockResolvedValue([recipient(11)]);
    mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(jest.mocked(notifyUsers).mock.calls[0][0].map((r) => r.userId)).toEqual([11]);
  });

  it("dispatch_recipients_loadedAsCertifiedMatchDm", async () => {
    mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    expect(loadNotificationRecipients).toHaveBeenCalledWith([11, 12, 21], "certified", { matchDm: true });
  });

  it("dispatch_matchDmOff_recipientStillPushedWithoutDiscord", async () => {
    jest.mocked(loadNotificationRecipients).mockResolvedValue([recipient(11, false), recipient(12), recipient(21)]);
    mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    expect(jest.mocked(notifyUsers).mock.calls[0][0][0]).toEqual({ userId: 11, discord: null });
  });

  it("dispatch_recipientLoadFails_dropsTheReservationForARetry", async () => {
    jest.mocked(loadEntrantPlayerIds).mockRejectedValue(new Error("base indisponible"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const db = mockDb({ candidates: [MATCH] });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(0);
    const [, params] = db.execute.mock.calls.find(([sql]) => sql.startsWith("DELETE FROM bg_new_match_notices")) ?? [];
    expect(params).toEqual([4, 1, "UPPER", 2, 1, "1:2"]);
    error.mockRestore();
  });

  it("dispatch_recipients_loadedAfterTheReservation", async () => {
    const db = mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    const insert = db.execute.mock.calls.findIndex(([sql]) => sql.trim().startsWith("INSERT IGNORE INTO bg_new_match_notices"));
    expect(jest.mocked(loadEntrantPlayerIds).mock.invocationCallOrder[0]).toBeGreaterThan(
      db.execute.mock.invocationCallOrder[insert],
    );
  });

  it("dispatch_claimTakenByAnotherSweep_keepsMarksAndSendsNothing", async () => {
    const startAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const db = mockDb({ candidates: [{ ...MATCH, start_at: startAt }], inserted: false });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(0);
    expect(db.execute.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM bg_match_reminders"))).toBe(false);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("dispatch_matchRepairedAfterInsert_dropsReservationAndReleasesMarks", async () => {
    const startAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const db = mockDb({ candidates: [{ ...MATCH, start_at: startAt }], claims: [true, false] });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(0);
    expect(db.execute.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM bg_new_match_notices"))).toBe(true);
    expect(db.execute.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM bg_match_reminders"))).toBe(true);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("dispatch_firstSideSendThrows_secondSideStillNotified", async () => {
    jest.mocked(notifyUsers).mockRejectedValueOnce(new Error("panne")).mockResolvedValue(SENT);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb({ candidates: [MATCH] });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(1);
    expect(notifyUsers).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("(match 40, engagée 1)"), expect.anything());
    error.mockRestore();
  });

  it("dispatch_thirdConsecutiveFailure_marksMatchSkipped", async () => {
    jest.mocked(loadEntrantPlayerIds).mockRejectedValue(new Error("base indisponible"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const db = mockDb({ candidates: [MATCH] });

    const clock = jest.spyOn(Date, "now");
    clock.mockReturnValue(1_000_000);
    await dispatchNewMatchNotices();
    clock.mockReturnValue(1_100_000);
    await dispatchNewMatchNotices();
    clock.mockReturnValue(1_200_000);
    await dispatchNewMatchNotices();
    clock.mockRestore();

    const skips = db.execute.mock.calls.filter(([sql]) => sql.trim().endsWith("VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"));
    expect(skips).toHaveLength(1);
    error.mockRestore();
  });

  it("dispatch_dissolvedOpponent_marksSkippedAndSendsNothing", async () => {
    const db = mockDb({ candidates: [{ ...MATCH, team2_deleted: 1 }] });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(0);
    expect(notifyUsers).not.toHaveBeenCalled();
    const [sql, params] = db.execute.mock.calls.find(([text]) => text.startsWith("SELECT m.tournament_id")) ?? [];
    expect(sql).toContain("m.team1_id = ? AND m.team2_id = ?");
    expect(params).toEqual([40, 1, 2]);
    expect(db.execute.mock.calls.some(([text]) => text.trim().endsWith("VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"))).toBe(true);
  });

  it("claimNewMatchNotice_recheckAfterInsert_ignoresALaterScheduleChange", async () => {
    const db = mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    const [first, second] = claimCalls(db);
    expect(first[0]).toContain("m.start_at <=> ?");
    expect(second[0]).not.toContain("m.start_at <=> ?");
    expect(second[0]).toContain("t2.deleted_at IS NULL");
  });

  it("dispatch_someMarksAlreadyHeld_releasesNoneWhenMatchChanged", async () => {
    const startAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const db = mockDb({ candidates: [{ ...MATCH, start_at: startAt }], claims: [false], marksTaken: 1 });

    await dispatchNewMatchNotices();

    expect(db.execute.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM bg_match_reminders"))).toBe(false);
  });

  it("dispatch_lockContention_neverCountsTowardSkipping", async () => {
    const contention = Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });
    jest.mocked(loadEntrantPlayerIds).mockRejectedValue(contention);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const db = mockDb({ candidates: [MATCH] });
    const clock = jest.spyOn(Date, "now");
    clock.mockReturnValue(1_000_000);
    await dispatchNewMatchNotices();
    clock.mockReturnValue(1_100_000);
    await dispatchNewMatchNotices();
    clock.mockReturnValue(1_200_000);
    await dispatchNewMatchNotices();
    clock.mockRestore();

    expect(db.execute.mock.calls.some(([sql]) => sql.trim().endsWith("VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"))).toBe(false);
    error.mockRestore();
  });

  it("dispatch_matchLeavesCandidates_forgetsItsFailures", async () => {
    jest.mocked(loadEntrantPlayerIds).mockRejectedValue(new Error("base indisponible"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const db = mockDb({ candidates: [MATCH] });
    const clock = jest.spyOn(Date, "now");
    clock.mockReturnValue(1_000_000);
    await dispatchNewMatchNotices();
    clock.mockReturnValue(1_100_000);
    await dispatchNewMatchNotices();
    db.query.mockResolvedValueOnce([[]]);
    clock.mockReturnValue(1_200_000);
    await dispatchNewMatchNotices();
    clock.mockReturnValue(1_300_000);
    await dispatchNewMatchNotices();
    clock.mockRestore();

    expect(db.execute.mock.calls.some(([sql]) => sql.trim().endsWith("VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"))).toBe(false);
    error.mockRestore();
  });

  it("newMatchPendingSql_noticesTableUnavailable_falseWithSamePlaceholders", () => {
    setNewMatchNoticesAvailable(false);

    const pending = newMatchPendingSql("?");
    const told = newMatchToldSql();
    setNewMatchNoticesAvailable(true);

    expect(pending).toBe("(? IS NULL AND ? IS NULL AND FALSE)");
    expect(told).toBe("FALSE");
  });

  it("dispatch_sweepStart_writesTheHeartbeat", async () => {
    const db = mockDb({ candidates: [] });

    await dispatchNewMatchNotices();

    const [sql, params] = db.execute.mock.calls.find(([text]) => text.startsWith("INSERT INTO bg_settings")) ?? [];
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(params).toEqual(["new_match_sweep_at"]);
  });

  it("dispatch_botUnreachable_keepsReservationAndLogs", async () => {
    jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [11], pushed: 0 });
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const db = mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();

    expect(error).toHaveBeenCalledWith(expect.stringContaining("bot injoignable"));
    expect(db.execute.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM bg_new_match_notices"))).toBe(false);
    error.mockRestore();
  });

  it("dispatch_notifyThrows_continuesWithNextMatch", async () => {
    jest.mocked(notifyUsers).mockRejectedValueOnce(new Error("panne")).mockResolvedValue(SENT);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb({ candidates: [MATCH, { ...MATCH, id: 41, team1_id: 3, team2_id: 4 }] });
    jest.mocked(loadEntrantPlayerIds).mockResolvedValue(
      new Map([
        [1, [11]],
        [3, [12]],
      ]),
    );

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("annonce en échec (match 40"), expect.anything());
    error.mockRestore();
  });

  it("dispatch_everySendFails_releasesReservationForNextSweep", async () => {
    jest.mocked(notifyUsers).mockRejectedValue(new Error("panne"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const db = mockDb({ candidates: [MATCH] });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(0);
    const [, params] = db.execute.mock.calls.find(([sql]) => sql.startsWith("DELETE FROM bg_new_match_notices")) ?? [];
    expect(params).toEqual([4, 1, "UPPER", 2, 1, "1:2"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("annonce en échec (match 40, essai 1)"), expect.anything());
    error.mockRestore();
  });

  it("dispatch_oneSideSentOtherFailed_keepsReservation", async () => {
    jest.mocked(notifyUsers).mockRejectedValueOnce(new Error("panne")).mockResolvedValue(SENT);
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const db = mockDb({ candidates: [MATCH] });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(1);
    expect(db.execute.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM bg_new_match_notices"))).toBe(false);
    error.mockRestore();
  });

  it("dispatch_sendFailsThreeSweepsInARow_marksMatchSkipped", async () => {
    jest.mocked(notifyUsers).mockRejectedValue(new Error("panne"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const db = mockDb({ candidates: [MATCH] });

    const clock = jest.spyOn(Date, "now");
    clock.mockReturnValue(1_000_000);
    await dispatchNewMatchNotices();
    clock.mockReturnValue(1_100_000);
    await dispatchNewMatchNotices();
    clock.mockReturnValue(1_200_000);
    await dispatchNewMatchNotices();
    clock.mockRestore();

    const skips = db.execute.mock.calls.filter(([sql]) => sql.trim().endsWith("VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"));
    expect(skips).toHaveLength(1);
    expect(skips[0][1]).toEqual([4, 1, "UPPER", 2, 1, "1:2", 1, 2]);
    error.mockRestore();
  });

  it("dispatch_secondCallWithinThrottle_doesNotSweepAgain", async () => {
    const db = mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();
    await dispatchNewMatchNotices();

    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
