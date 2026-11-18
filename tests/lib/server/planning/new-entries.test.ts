import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://bluegenji.test" }));
jest.mock("@/lib/server/tournaments/cast-eligibility");
jest.mock("@/lib/server/planning/load", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/load")>("@/lib/server/planning/load"),
  loadPlanningEntries: jest.fn(),
  loadPlanningMembers: jest.fn(),
}));
jest.mock("@/lib/server/planning/players", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/players")>("@/lib/server/planning/players"),
  loadEntryPlayers: jest.fn(),
}));

import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { loadPlanningEntries, loadPlanningMembers } from "@/lib/server/planning/load";
import {
  announceWave,
  collectWave,
  digestRecipients,
  groupByEntries,
  NEW_ENTRIES_MAX_WAIT_MS,
  NEW_ENTRIES_QUIET_MS,
  waveReady,
} from "@/lib/server/planning/new-entries";
import { loadEntryPlayers } from "@/lib/server/planning/players";
import { loadEligibleRefereeIds } from "@/lib/server/tournaments/cast-eligibility";
import { HOUR_MS, loadedEntry, loadedMember, MONDAY } from "../../../helpers/planning";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";

/** Récapitulatif des nouvelles entrées (`CAST_PLANNING.md` § Notifications) : une vague, un message. */

const NOW = MONDAY - 72 * HOUR_MS;
const connection = connectionMock();
const { execute } = connection;

beforeEach(() => {
  jest.clearAllMocks();
  execute.mockResolvedValue([{ affectedRows: 1 }]);
  jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry()]);
  jest.mocked(loadEntryPlayers).mockResolvedValue(new Map());
  jest.mocked(loadEligibleRefereeIds).mockImplementation(async (_executor, ids) => new Set(ids));
  jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) => ids.map((userId) => ({ userId, discord: null })));
  jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [], pushed: 0 });
});

/** Les lignes de `bg_planning_entry_notices` que rend la base. */
function knownNotices(rows: { entry_key: string; seen_at: Date; announced_at: Date | null }[]) {
  execute.mockImplementation(async (sql: string) => (sql.startsWith("SELECT entry_key") ? [rows] : [{ affectedRows: 1 }]));
}

function statements(): string[] {
  return execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim().slice(0, 40));
}

describe("waveReady", () => {
  it("waveReady_newestJustUnderQuiet_notReady", () => {
    expect(waveReady([NOW - NEW_ENTRIES_QUIET_MS + 1], NOW)).toBe(false);
  });

  it("waveReady_newestQuietExactly_ready", () => {
    expect(waveReady([NOW - NEW_ENTRIES_QUIET_MS], NOW)).toBe(true);
  });

  it("waveReady_burstStillGoingButOldestAtMaxWait_ready", () => {
    expect(waveReady([NOW - NEW_ENTRIES_MAX_WAIT_MS, NOW], NOW)).toBe(true);
  });

  it("waveReady_empty_notReady", () => {
    expect(waveReady([], NOW)).toBe(false);
  });
});

describe("digestRecipients", () => {
  const entry = loadedEntry();
  const noPlayers = () => new Set<number>();

  it("digestRecipients_casterAndProd_receiveEveryEntry", () => {
    const members = [loadedMember({ userId: 4, roles: ["CASTER"] }), loadedMember({ userId: 6, roles: ["PROD"] })];

    expect([...digestRecipients([entry], members, new Map(), noPlayers).keys()]).toEqual([4, 6]);
  });

  it("digestRecipients_refereeEligibleForGame_receivesEntry", () => {
    const members = [loadedMember({ userId: 3 })];

    expect([...digestRecipients([entry], members, new Map([["OW", new Set([3])]]), noPlayers).keys()]).toEqual([3]);
  });

  it("digestRecipients_refereeNotEligible_skipped", () => {
    const members = [loadedMember({ userId: 3 })];

    expect(digestRecipients([entry], members, new Map([["OW", new Set<number>()]]), noPlayers).size).toBe(0);
  });

  it("digestRecipients_memberPlaysTheEntry_skipped", () => {
    const members = [loadedMember({ userId: 4, roles: ["CASTER"] })];

    expect(digestRecipients([entry], members, new Map(), () => new Set([4])).size).toBe(0);
  });

  it("digestRecipients_hiddenTournamentMemberCannotSeeIt_skipped", () => {
    const members = [loadedMember({ userId: 4, roles: ["CASTER"], seesHidden: false })];

    expect(digestRecipients([loadedEntry({ hidden: true })], members, new Map(), noPlayers).size).toBe(0);
  });
});

describe("groupByEntries", () => {
  it("groupByEntries_sameEntriesInAnyOrder_oneGroup", () => {
    const first = loadedEntry({ key: "m:1" });
    const second = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + HOUR_MS });

    const groups = groupByEntries(
      new Map([
        [4, [first, second]],
        [6, [second, first]],
      ]),
    );

    expect(groups).toEqual([{ userIds: [4, 6], entries: [first, second] }]);
  });

  it("groupByEntries_differentEntries_separateGroups", () => {
    const groups = groupByEntries(
      new Map([
        [4, [loadedEntry({ key: "m:1" })]],
        [6, [loadedEntry({ key: "m:2" })]],
      ]),
    );

    expect(groups).toHaveLength(2);
  });
});

describe("collectWave", () => {
  it("collectWave_emptyTable_marksEverythingAnnouncedWithoutWave", async () => {
    knownNotices([]);

    const wave = await collectWave(fakeConnection(connection), NOW);

    expect(wave).toEqual([]);
    expect(statements()).toEqual(["SELECT entry_key, seen_at, announced_at ", "INSERT IGNORE INTO bg_planning_entry_not"]);
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 10, 1, new Date(NOW), new Date(NOW)]);
  });

  it("collectWave_freshEntry_notedPendingWithoutWave", async () => {
    knownNotices([{ entry_key: "m:9", seen_at: new Date(NOW - HOUR_MS), announced_at: new Date(NOW - HOUR_MS) }]);

    const wave = await collectWave(fakeConnection(connection), NOW);

    expect(wave).toEqual([]);
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 10, 1, new Date(NOW), null]);
  });

  it("collectWave_pendingWaveQuiet_markedAnnouncedThenReturned", async () => {
    knownNotices([{ entry_key: "m:1", seen_at: new Date(NOW - NEW_ENTRIES_QUIET_MS), announced_at: null }]);

    const wave = await collectWave(fakeConnection(connection), NOW);

    expect(wave.map((entry) => entry.key)).toEqual(["m:1"]);
    expect(statements()).toEqual(["SELECT entry_key, seen_at, announced_at ", "UPDATE bg_planning_entry_notices SET ann"]);
  });

  it("collectWave_pendingEntryNoLongerOpen_markedButNotReturned", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ open: false })]);
    knownNotices([{ entry_key: "m:1", seen_at: new Date(NOW - NEW_ENTRIES_QUIET_MS), announced_at: null }]);

    const wave = await collectWave(fakeConnection(connection), NOW);

    expect(wave).toEqual([]);
    expect(execute.mock.calls[1][1]).toEqual([new Date(NOW), "m:1"]);
  });
});

describe("announceWave", () => {
  it("announceWave_sameEntriesForTwoMembers_oneDigestForBoth", async () => {
    jest.mocked(loadPlanningMembers).mockResolvedValue([
      loadedMember({ userId: 4, roles: ["CASTER"] }),
      loadedMember({ userId: 6, roles: ["PROD"] }),
    ]);

    await announceWave(fakeConnection(connection), [loadedEntry()]);

    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(jest.mocked(loadNotificationRecipients).mock.calls[0]).toEqual([[4, 6], "proven"]);
    expect(jest.mocked(notifyUsers).mock.calls[0][1]).toMatchObject({ topic: "PLANNING_NEW_ENTRIES", dmFollowsTopic: true });
  });

  it("announceWave_emptyWave_sendsNothing", async () => {
    await announceWave(fakeConnection(connection), []);

    expect(loadPlanningMembers).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("announceWave_loadFails_neverThrows", async () => {
    jest.mocked(loadPlanningMembers).mockRejectedValue(new Error("ECONNRESET"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(announceWave(fakeConnection(connection), [loadedEntry()])).resolves.toBeUndefined();
    error.mockRestore();
  });
});
