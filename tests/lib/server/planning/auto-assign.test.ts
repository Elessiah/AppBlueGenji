import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/named-lock", () => ({
  ...jest.requireActual<typeof import("@/lib/server/named-lock")>("@/lib/server/named-lock"),
  withNamedLock: jest.fn(),
}));
jest.mock("@/lib/server/planning/load", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/load")>("@/lib/server/planning/load"),
  loadPlanningData: jest.fn(),
  loadPlanningHistory: jest.fn(),
}));
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/match-players");
jest.mock("@/lib/server/tournaments/cast-eligibility");

import type { PoolConnection } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import {
  batchEntries,
  confirmAssignments,
  entriesToConfirm,
  preparePlanner,
  runAutoAssign,
  withPlanningLock,
} from "@/lib/server/planning/auto-assign";
import { loadPlanningData, loadPlanningHistory } from "@/lib/server/planning/load";
import { loadEligibleRefereeIds } from "@/lib/server/tournaments/cast-eligibility";
import { assignMatchReferee } from "@/lib/server/tournaments/match-launch";
import { loadMatchPlayerIds } from "@/lib/server/tournaments/match-players";
import { available, HOUR_MS, loadedAssignment, loadedEntry, loadedMember, MONDAY, planningData } from "../../../helpers/planning";
import { fakeConnection, fakePool, type SqlQuery } from "../../../helpers/sql-double";

/**
 * Calcul par lot et confirmation (`CAST_PLANNING.md` § Calcul, § Provisoire,
 * confirmé, manuel) : base simulée, verrou toujours obtenu.
 */

const execute = jest.fn<SqlQuery>();

beforeEach(() => {
  jest.clearAllMocks();
  execute.mockResolvedValue([{ affectedRows: 0 }]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({}));
  jest.mocked(withNamedLock).mockImplementation(<T>(_pool: unknown, _name: string, _seconds: number, run: (c: PoolConnection) => Promise<T>) =>
    run(fakeConnection({ execute })),
  );
  jest.mocked(loadPlanningHistory).mockResolvedValue(new Map());
  jest.mocked(loadMatchPlayerIds).mockResolvedValue(new Set());
  jest.mocked(loadEligibleRefereeIds).mockImplementation(async (_executor, ids) => new Set(ids));
  jest.mocked(assignMatchReferee).mockResolvedValue(undefined);
});

/** Requêtes jouées, réduites à leur début (le verbe et la table). */
function statements(): string[] {
  return execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim().slice(0, 40));
}

describe("batchEntries / entriesToConfirm", () => {
  const entries = [
    loadedEntry({ key: "m:1", startAt: MONDAY }),
    loadedEntry({ key: "m:2", startAt: MONDAY + 50 * HOUR_MS }),
    loadedEntry({ key: "m:3", startAt: MONDAY + HOUR_MS, open: false }),
  ];

  it("batchEntries_onlyOpenInsideWindow", () => {
    const batch = batchEntries({ entries }, { from: MONDAY, to: MONDAY + 24 * HOUR_MS });
    expect(batch.map((entry) => entry.key)).toEqual(["m:1"]);
  });

  it("entriesToConfirm_namedKeys_only", () => {
    expect(entriesToConfirm({ entries }, { entryKeys: ["m:2"] }).map((entry) => entry.key)).toEqual(["m:2"]);
  });

  it("entriesToConfirm_until_onlyEarlier", () => {
    expect(entriesToConfirm({ entries }, { until: MONDAY + 10 * HOUR_MS }).map((entry) => entry.key)).toEqual(["m:1"]);
  });

  it("entriesToConfirm_closedNamed_excluded", () => {
    expect(entriesToConfirm({ entries }, { entryKeys: ["m:3"] })).toEqual([]);
  });
});

describe("preparePlanner", () => {
  const inside = loadedEntry({ key: "m:1" });
  const outside = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + 200 * HOUR_MS, endAt: MONDAY + 201 * HOUR_MS });

  it("preparePlanner_provisionalInBatch_unlocked_outsideBatch_locked", () => {
    const data = planningData({
      entries: [inside, outside],
      assignments: [
        loadedAssignment({ entryKey: "m:1", userId: 1, role: "CASTER" }),
        loadedAssignment({ entryKey: "m:2", userId: 2, role: "CASTER" }),
      ],
    });

    const input = preparePlanner(data, [inside], new Map(), new Set());

    expect(input.locked).toEqual([{ entryKey: "m:2", userId: 2, role: "CASTER", reason: "LOAD" }]);
    expect(input.entries.map((entry) => [entry.key, entry.open])).toEqual([
      ["m:1", true],
      ["m:2", false],
    ]);
  });

  it("preparePlanner_confirmedAndManual_locked", () => {
    const data = planningData({
      entries: [inside],
      assignments: [
        loadedAssignment({ userId: 1, role: "CASTER", confirmed: true }),
        loadedAssignment({ userId: 2, role: "PROD", source: "MANUAL", reason: "MANUAL", confirmed: true }),
      ],
    });

    const input = preparePlanner(data, [inside], new Map(), new Set());

    expect(input.locked.map((row) => row.userId)).toEqual([1, 2]);
  });

  it("preparePlanner_tournamentEntry_twoRefereeSlots", () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });

    const input = preparePlanner(planningData({ entries: [event, inside] }), [event, inside], new Map(), new Set());

    expect(input.entries.map((entry) => entry.refereeSlots)).toEqual([2, 1]);
  });

  it("preparePlanner_selfManaged_refereeDecided", () => {
    const managed = loadedEntry({ selfManaged: true });

    const input = preparePlanner(planningData({ entries: [managed] }), [managed], new Map(), new Set());

    expect([...input.refereeDecided]).toEqual(["m:1"]);
  });

  it("preparePlanner_soloMembers_soloCasterIds", () => {
    const data = planningData({
      entries: [inside],
      members: [loadedMember({ userId: 4, roles: ["CASTER"], soloCaster: true }), loadedMember({ userId: 5, roles: ["CASTER"] })],
    });

    expect([...preparePlanner(data, [inside], new Map(), new Set()).soloCasterIds]).toEqual([4]);
  });
});

describe("withPlanningLock", () => {
  it("withPlanningLock_lockUnavailable_throwsPlanningBusy", async () => {
    jest.mocked(withNamedLock).mockRejectedValue(new NamedLockUnavailableError("bg_planning", 10));

    await expect(withPlanningLock(async () => 1)).rejects.toThrow("PLANNING_BUSY");
  });
});

describe("runAutoAssign", () => {
  it("runAutoAssign_emptyBatch_reportZeros_noWrites", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()] }));

    const report = await runAutoAssign(9, { from: MONDAY + 100 * HOUR_MS, to: MONDAY + 120 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report).toEqual({ entries: 0, proposed: 0, replaced: 0 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("runAutoAssign_deletesProvisionalOfBatchThenInsertsAuto", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
      }),
    );
    execute.mockResolvedValueOnce([{ affectedRows: 2 }]);

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report).toEqual({ entries: 1, proposed: 1, replaced: 2 });
    expect(statements()).toEqual([
      "DELETE FROM bg_planning_assignments WHER",
      "INSERT INTO bg_planning_assignments (ent",
      "INSERT INTO bg_planning_events (entry_ke",
    ]);
    expect(execute.mock.calls[0][0]).toContain("source = 'AUTO' AND confirmed = 0");
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 3, "REFEREE", 10, 1, "AUTO", "LOAD", 0, 9]);
  });

  it("runAutoAssign_matchPlayer_excluded", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
      }),
    );
    jest.mocked(loadMatchPlayerIds).mockResolvedValue(new Set([3]));

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report.proposed).toBe(0);
  });

  it("runAutoAssign_ineligibleReferee_excluded", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
      }),
    );
    jest.mocked(loadEligibleRefereeIds).mockResolvedValue(new Set());

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report.proposed).toBe(0);
  });

  it("runAutoAssign_manualRemoval_notProposedAgain", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
        removals: [{ entryKey: "m:1", userId: 3, role: "REFEREE" }],
      }),
    );

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report.proposed).toBe(0);
  });
});

describe("confirmAssignments", () => {
  const first = loadedEntry({ key: "m:1", matchId: 1 });
  const second = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + 5 * HOUR_MS, endAt: MONDAY + 6 * HOUR_MS });

  it("confirmAssignments_subset_confirmsOnlyNamedProvisional", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [first, second],
        assignments: [
          loadedAssignment({ entryKey: "m:1", userId: 4, role: "CASTER" }),
          loadedAssignment({ entryKey: "m:1", userId: 6, role: "PROD", confirmed: true }),
          loadedAssignment({ entryKey: "m:2", userId: 5, role: "CASTER" }),
        ],
      }),
    );

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 1, refused: 0 });
    expect(execute.mock.calls[0][1]).toEqual(["m:1", 4, "CASTER"]);
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 4, "CASTER", 10, 1, "CONFIRMED", "AUTO", 9]);
    expect(assignMatchReferee).not.toHaveBeenCalled();
  });

  it("confirmAssignments_matchReferee_appliedViaAssignMatchReferee", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );

    const report = await confirmAssignments(9, { until: MONDAY + HOUR_MS }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 1, refused: 0 });
    expect(assignMatchReferee).toHaveBeenCalledWith(1, 9, 3, null);
  });

  it("confirmAssignments_refereeRefused_rowDeletedRemovedEventCounted", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );
    jest.mocked(assignMatchReferee).mockRejectedValue(new Error("REFEREE_IS_PLAYER"));

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 1 });
    expect(statements()).toEqual([
      "DELETE FROM bg_planning_assignments WHER",
      "INSERT INTO bg_planning_events (entry_ke",
    ]);
    expect(execute.mock.calls[1][1]).toContain("REMOVED");
  });

  it("confirmAssignments_tournamentReferee_noMatchCall", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [event], assignments: [loadedAssignment({ entryKey: "t:10", userId: 3, role: "REFEREE" })] }),
    );

    const report = await confirmAssignments(9, { entryKeys: ["t:10"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 1, refused: 0 });
    expect(assignMatchReferee).not.toHaveBeenCalled();
  });
});
