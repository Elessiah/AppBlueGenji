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
};

type Db = { execute: jest.Mock<SqlQuery>; query: jest.Mock<SqlQuery> };

/**
 * Base simulée : `installed` = clé de mise en service déjà posée ;
 * `candidates` = matchs à annoncer ; `claims` = issue de chaque réservation.
 */
function mockDb(options: { installed?: boolean; candidates?: object[]; claims?: boolean[] } = {}): Db {
  const claims = [...(options.claims ?? [])];
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.startsWith("SELECT 1 FROM bg_settings")) return [options.installed === false ? [] : [{ 1: 1 }]];
    if (sql.startsWith("INSERT IGNORE INTO bg_settings")) return [{ affectedRows: 1 }];
    if (sql.trim().startsWith("INSERT IGNORE INTO bg_match_reminders")) return [{ affectedRows: 1 }];
    if (sql.startsWith("INSERT IGNORE INTO bg_new_match_notices")) {
      if (sql.includes(", 1\n")) return [{ affectedRows: 3 }];
      const claimed = claims.length > 0 ? claims.shift() : true;
      return [{ affectedRows: claimed ? 1 : 0 }];
    }
    throw new Error(`requête inattendue : ${sql}`);
  });
  const query = jest.fn<SqlQuery>(async () => [options.candidates ?? []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, query }));
  return { execute, query };
}

function reminderMarks(db: Db): unknown[] {
  return db.execute.mock.calls
    .filter(([sql]) => sql.trim().startsWith("INSERT IGNORE INTO bg_match_reminders"))
    .map(([, params]) => (params as unknown[])[1]);
}

function recipient(userId: number, discord = true) {
  return { userId, discord: discord ? { discordId: `d${userId}`, handle: null, label: `p${userId}` } : null };
}

function claimCalls(db: Db) {
  return db.execute.mock.calls.filter(
    ([sql]) => sql.startsWith("INSERT IGNORE INTO bg_new_match_notices") && !sql.includes(", 1\n"),
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

    const statements = db.execute.mock.calls.map(([sql]) => sql.trim().split("\n")[0]);
    const skipIndex = statements.findIndex((sql) => sql.startsWith("INSERT IGNORE INTO bg_new_match_notices"));
    const keyIndex = statements.findIndex((sql) => sql.startsWith("INSERT IGNORE INTO bg_settings"));
    expect(skipIndex).toBeGreaterThan(-1);
    expect(keyIndex).toBeGreaterThan(skipIndex);
  });

  it("installNewMatchNotices_alreadyInstalled_marksNothing", async () => {
    const db = mockDb({ candidates: [] });

    await dispatchNewMatchNotices();

    expect(db.execute.mock.calls.some(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_new_match_notices"))).toBe(false);
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
    const order = db.execute.mock.calls.map(([sql]) => sql.trim().split("\n")[0]);
    expect(order.findIndex((sql) => sql.startsWith("INSERT IGNORE INTO bg_match_reminders"))).toBeLessThan(
      order.findIndex((sql) => sql.startsWith("INSERT IGNORE INTO bg_new_match_notices")),
    );
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
    expect(sql).toContain("INSERT IGNORE INTO bg_new_match_notices");
    expect(sql).toContain("LEAST(m.team1_id, m.team2_id)");
    expect(sql).toContain("m.launched_at IS NULL");
    expect(params).toEqual([40, 1, 2]);
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

  it("dispatch_recipientLoadFails_reservesNothing", async () => {
    jest.mocked(loadEntrantPlayerIds).mockRejectedValue(new Error("base indisponible"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const db = mockDb({ candidates: [MATCH] });

    const sides = await dispatchNewMatchNotices();

    expect(sides).toBe(0);
    expect(claimCalls(db)).toHaveLength(0);
    error.mockRestore();
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
    expect(error).toHaveBeenCalledWith(expect.stringContaining("annonce en échec (match 40)"), expect.anything());
    error.mockRestore();
  });

  it("dispatch_secondCallWithinThrottle_doesNotSweepAgain", async () => {
    const db = mockDb({ candidates: [MATCH] });

    await dispatchNewMatchNotices();
    await dispatchNewMatchNotices();

    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
