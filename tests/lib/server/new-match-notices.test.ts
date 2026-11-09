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
 * Base simulée : `unbased` = tournois en cours sans ligne de départ ;
 * `candidates` = matchs à annoncer ; `claims` = issue de chaque réservation.
 */
function mockDb(options: { unbased?: number[]; candidates?: object[]; claims?: boolean[] } = {}): Db {
  const claims = [...(options.claims ?? [])];
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.startsWith("DELETE b FROM bg_new_match_baselines")) return [{ affectedRows: 0 }];
    if (sql.startsWith("SELECT t.id FROM bg_tournaments")) return [(options.unbased ?? []).map((id) => ({ id }))];
    if (sql.startsWith("INSERT IGNORE INTO bg_new_match_baselines")) return [{ affectedRows: 1 }];
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
  it("dispatch_firstSightOfRunningTournament_marksExistingMatchesSkippedThenBaseline", async () => {
    const db = mockDb({ unbased: [4] });

    await dispatchNewMatchNotices();

    const statements = db.execute.mock.calls.map(([sql]) => sql.split("\n")[0].trim());
    const skipIndex = statements.findIndex((sql) => sql.startsWith("INSERT IGNORE INTO bg_new_match_notices"));
    const baselineIndex = statements.findIndex((sql) => sql.startsWith("INSERT IGNORE INTO bg_new_match_baselines"));
    expect(skipIndex).toBeGreaterThan(-1);
    expect(baselineIndex).toBeGreaterThan(skipIndex);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("layNewMatchBaselines_eachSweep_dropsBaselinesOfNonRunningTournaments", async () => {
    const db = mockDb();

    await dispatchNewMatchNotices();

    expect(db.execute.mock.calls[0][0]).toContain("WHERE t.state <> 'RUNNING'");
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
