import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/named-lock", () => ({
  ...jest.requireActual<typeof import("@/lib/server/named-lock")>("@/lib/server/named-lock"),
  withNamedLock: jest.fn(),
}));
jest.mock("@/lib/server/planning/load", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/load")>("@/lib/server/planning/load"),
  loadPlanningData: jest.fn(),
  loadPlanningMembers: jest.fn(),
}));
jest.mock("@/lib/server/planning/profiles");
jest.mock("@/lib/server/planning/players", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/players")>("@/lib/server/planning/players"),
  loadEntryPlayers: jest.fn(),
}));
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/notifications");

import type { PoolConnection } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import { withNamedLock } from "@/lib/server/named-lock";
import { PLANNING_STATUSES, setAvailability, setManualAssignment, setSoloCaster } from "@/lib/server/planning/actions";
import { MATCH_REFEREE_REFUSAL_CODES } from "@/lib/server/planning/auto-assign";
import { loadPlanningData, loadPlanningMembers } from "@/lib/server/planning/load";
import { loadEntryPlayers } from "@/lib/server/planning/players";
import { writeSoloCaster } from "@/lib/server/planning/profiles";
import { assignMatchReferee } from "@/lib/server/tournaments/match-launch";
import { authUser } from "../../../helpers/auth-user";
import { HOUR_MS, loadedAssignment, loadedEntry, loadedMember, MONDAY, planningData } from "../../../helpers/planning";
import { connectionMock, fakeConnection, fakePool } from "../../../helpers/sql-double";

/** Gestes du planning : sa disponibilité, le caster autonome, la désignation à la main (`CAST_PLANNING.md`). */

const connection = connectionMock();
const { execute } = connection;
const staff = authUser({ id: 9, roles: ["ARBITRE"] });
const prod = authUser({ id: 6, roles: ["PROD"] });
const READY_AT = new Date("2026-11-16T19:00:00Z");

/** Ligne `bg_matches` que lit l'instantané d'arbitrage (`match-restore.ts`). */
function matchRow(overrides: Record<string, unknown> = {}) {
  return { tournament_id: 10, referee_user_id: null, referee_ready_at: null, self_managed: 0, status: "READY", ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  execute.mockResolvedValue([{ affectedRows: 1 }]);
  connection.beginTransaction.mockResolvedValue(undefined);
  connection.commit.mockResolvedValue(undefined);
  connection.rollback.mockResolvedValue(undefined);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({}));
  jest.mocked(withConnection).mockImplementation(<T>(run: (c: PoolConnection) => Promise<T>) => run(fakeConnection(connection)));
  jest.mocked(withNamedLock).mockImplementation(<T>(_pool: unknown, _name: string, _seconds: number, run: (c: PoolConnection) => Promise<T>) =>
    run(fakeConnection(connection)),
  );
  jest.mocked(loadEntryPlayers).mockResolvedValue(new Map());
  jest.mocked(assignMatchReferee).mockResolvedValue(undefined);
  jest.mocked(writeSoloCaster).mockResolvedValue(undefined);
});

describe("setAvailability", () => {
  it("setAvailability_roleNotHeld_throwsRoleNotHeld", async () => {
    await expect(setAvailability(prod, { entryKey: "m:1", role: "CASTER", status: "AVAILABLE", preferred: false })).rejects.toThrow(
      "PLANNING_ROLE_NOT_HELD",
    );
    expect(loadPlanningData).not.toHaveBeenCalled();
  });

  it("setAvailability_unknownEntry_throwsNotFound", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData());

    await expect(setAvailability(prod, { entryKey: "m:1", role: "PROD", status: "AVAILABLE", preferred: false })).rejects.toThrow(
      "PLANNING_ENTRY_NOT_FOUND",
    );
  });

  it("setAvailability_closedEntry_throwsClosed", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ open: false })] }));

    await expect(setAvailability(prod, { entryKey: "m:1", role: "PROD", status: "AVAILABLE", preferred: false })).rejects.toThrow(
      "PLANNING_ENTRY_CLOSED",
    );
  });

  it("setAvailability_valid_upserts", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()] }));

    await setAvailability(prod, { entryKey: "m:1", role: "PROD", status: "PENDING", preferred: true });

    expect(execute.mock.calls[0][1]).toEqual(["m:1", 6, "PROD", 10, 1, "PENDING", 1]);
  });

  it("setAvailability_nonStaff_hiddenTournamentsNotLoaded", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()] }));

    await setAvailability(prod, { entryKey: "m:1", role: "PROD", status: "AVAILABLE", preferred: false });

    expect(jest.mocked(loadPlanningData).mock.calls[0][1]).toMatchObject({ includeHidden: false });
  });
});

describe("setSoloCaster", () => {
  it("setSoloCaster_notCaster_throwsNotCaster", async () => {
    jest.mocked(loadPlanningMembers).mockResolvedValue([loadedMember({ userId: 6, roles: ["PROD"] })]);

    await expect(setSoloCaster(6, true)).rejects.toThrow("NOT_CASTER");
    expect(writeSoloCaster).not.toHaveBeenCalled();
  });

  it("setSoloCaster_caster_writes", async () => {
    jest.mocked(loadPlanningMembers).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"] })]);

    await setSoloCaster(4, true);

    expect(writeSoloCaster).toHaveBeenCalledWith(expect.anything(), 4, true);
  });
});

describe("setManualAssignment — pose", () => {
  const members = [
    loadedMember({ userId: 3, roles: ["REFEREE"] }),
    loadedMember({ userId: 4, roles: ["CASTER", "PROD"] }),
    loadedMember({ userId: 6, roles: ["PROD"] }),
  ];

  it("setManualAssignment_notEditable_throwsClosed", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ editable: false })], members }));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "PROD", userId: 6, assigned: true })).rejects.toThrow(
      "PLANNING_ENTRY_CLOSED",
    );
  });

  it("setManualAssignment_roleNotHeld_throws", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()], members }));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 6, assigned: true })).rejects.toThrow(
      "PLANNING_ROLE_NOT_HELD",
    );
  });

  it("setManualAssignment_casterOnEntryWhereProd_throwsConflict", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [loadedEntry()], members, assignments: [loadedAssignment({ userId: 4, role: "PROD" })] }),
    );

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true })).rejects.toThrow(
      "PLANNING_ROLE_CONFLICT",
    );
  });

  it("setManualAssignment_castSource_throwsCastManaged", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [loadedEntry()], members, matchCasters: new Map([["m:1", [4]]]) }),
    );

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true })).rejects.toThrow(
      "PLANNING_CAST_MANAGED",
    );
  });

  it("setManualAssignment_matchReferee_callsAssignMatchReferee", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true });

    expect(assignMatchReferee).toHaveBeenCalledWith(1, 9, 3, 7);
    expect(execute.mock.calls[0][0]).toContain("FROM bg_matches WHERE id = ?");
    expect(execute.mock.calls[1][0]).toContain("DELETE FROM bg_planning_assignments");
  });

  it("setManualAssignment_tournamentCaster_writesManualConfirmed", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [event], members }));

    await setManualAssignment(staff, { entryKey: "t:10", role: "CASTER", userId: 4, assigned: true });

    expect(assignMatchReferee).not.toHaveBeenCalled();
    expect(execute.mock.calls[0][1]).toEqual(["t:10", 4, "CASTER", 10, null, "MANUAL", "MANUAL", 1, 9]);
    expect(connection.commit).toHaveBeenCalled();
  });

  it("setManualAssignment_casterPlaysMatch_throwsIsPlayer", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()], members }));
    jest.mocked(loadEntryPlayers).mockResolvedValue(new Map([["m:1", new Set([4])]]));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true })).rejects.toThrow(
      "PLANNING_IS_PLAYER",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("setManualAssignment_confirmedOverlappingEntry_throwsOverlap", async () => {
    const other = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + HOUR_MS / 2, endAt: MONDAY + 2 * HOUR_MS });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry(), other],
        members,
        assignments: [loadedAssignment({ entryKey: "m:2", userId: 4, role: "CASTER", confirmed: true })],
      }),
    );

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true })).rejects.toThrow(
      "PLANNING_OVERLAP",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("setManualAssignment_provisionalOverlappingProposal_releasedThenAssigned", async () => {
    const other = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + HOUR_MS / 2, endAt: MONDAY + 2 * HOUR_MS });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry(), other],
        members,
        assignments: [loadedAssignment({ entryKey: "m:2", userId: 4, role: "CASTER" })],
      }),
    );

    await setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true });

    expect(execute.mock.calls[0][0]).toContain("source = 'AUTO' AND confirmed = 0");
    expect(execute.mock.calls[0][1]).toEqual(["m:2", 4, "CASTER"]);
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 4, "CASTER", 10, 1, "MANUAL", "MANUAL", 1, 9]);
  });

  it("setManualAssignment_writeFailsAfterRefereeMoved_previousStateRestoredBySnapshot", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    execute
      .mockResolvedValueOnce([[matchRow({ referee_user_id: 7, referee_ready_at: READY_AT })], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "ER_LOCK_DEADLOCK",
    );
    expect(connection.rollback).toHaveBeenCalled();
    expect(assignMatchReferee).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[3][0]).toContain("UPDATE bg_matches SET referee_user_id = ?");
    expect(execute.mock.calls[3][1]).toEqual([7, READY_AT, 0, 1, 3, "READY"]);
  });

  it("setManualAssignment_selfManagedMatchWriteFails_selfManagementRestored", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()], members }));
    execute
      .mockResolvedValueOnce([[matchRow({ self_managed: 1 })], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "ER_LOCK_DEADLOCK",
    );
    expect(execute.mock.calls[3][1]).toEqual([null, null, 1, 1, 3, "READY"]);
  });

  it("setManualAssignment_assignMatchRefereeThrows_restoreAttempted", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    execute.mockResolvedValueOnce([[matchRow({ referee_user_id: 7 })], []]);
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("PUBLISH_FAILED"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "PUBLISH_FAILED",
    );
    expect(execute.mock.calls[2][0]).toContain("referee_user_id <=> ?");
  });

  it("setManualAssignment_overlappingCastSignup_throwsOverlapManaged", async () => {
    const other = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + HOUR_MS / 2, endAt: MONDAY + 2 * HOUR_MS });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [loadedEntry(), other], members, matchCasters: new Map([["m:2", [4]]]) }),
    );

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true })).rejects.toThrow(
      "PLANNING_OVERLAP_MANAGED",
    );
  });

  it("setManualAssignment_overlappingMatchReferee_throwsOverlapManaged", async () => {
    const other = loadedEntry({ key: "m:2", matchId: 2, matchRefereeId: 3, startAt: MONDAY + HOUR_MS / 2, endAt: MONDAY + 2 * HOUR_MS });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry(), other], members }));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "PLANNING_OVERLAP_MANAGED",
    );
  });
});

describe("setManualAssignment — retrait", () => {
  it("unassign_notAssigned_throws", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()] }));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "PROD", userId: 6, assigned: false })).rejects.toThrow(
      "PLANNING_NOT_ASSIGNED",
    );
  });

  it("unassign_castSource_throwsCastManaged", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()], matchCasters: new Map([["m:1", [4]]]) }));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: false })).rejects.toThrow(
      "PLANNING_CAST_MANAGED",
    );
  });

  it("unassign_provisionalReferee_doesNotTouchMatch_writesRemovedManual", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [loadedEntry()], assignments: [loadedAssignment({ userId: 3, role: "REFEREE" })] }),
    );

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: false });

    expect(assignMatchReferee).not.toHaveBeenCalled();
    expect(execute.mock.calls[1][1]).toEqual(["m:1", 3, "REFEREE", 10, 1, "REMOVED", "MANUAL", 9]);
  });

  it("unassign_confirmedMatchReferee_releasesOnMatch", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 3 })] }));

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: false });

    expect(assignMatchReferee).toHaveBeenCalledWith(1, 9, null, 3);
  });

  it("unassign_writeFailsAfterRelease_restoredWithNullCas", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 3 })] }));
    execute
      .mockResolvedValueOnce([[matchRow({ referee_user_id: 3, referee_ready_at: READY_AT })], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: false })).rejects.toThrow(
      "ER_LOCK_DEADLOCK",
    );
    expect(assignMatchReferee).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[3][1]).toEqual([3, READY_AT, 0, 1, null, "READY"]);
  });
});

describe("PLANNING_STATUSES", () => {
  it("PLANNING_STATUSES_everyMatchRefereeRefusal_mapped", () => {
    for (const code of MATCH_REFEREE_REFUSAL_CODES) expect(PLANNING_STATUSES[code]).toBeDefined();
    expect(PLANNING_STATUSES.MATCH_NOT_FOUND).toBe(404);
    expect(PLANNING_STATUSES.REFEREE_DISCORD_REQUIRED).toBe(409);
    expect(PLANNING_STATUSES.PLANNING_OVERLAP_MANAGED).toBe(409);
  });
});
