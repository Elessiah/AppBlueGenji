import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/planning/load", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/load")>("@/lib/server/planning/load"),
  loadPlanningData: jest.fn(),
  loadPlanningMembers: jest.fn(),
  loadSoloCasterIds: jest.fn(),
}));

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { loadPlanningData, loadPlanningMembers, loadSoloCasterIds, type LoadedAvailability } from "@/lib/server/planning/load";
import { loadPlanningView, PLANNING_MEMBERS_TTL_MS, resetPlanningMembersCache } from "@/lib/server/planning/view";
import { authUser } from "../../../helpers/auth-user";
import { loadedEntry, loadedMember, MONDAY, planningData } from "../../../helpers/planning";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";

/** La page « Planning » : copie brève des comptes, réglage autonome relu, disponibilités regroupées (`CAST_PLANNING.md`). */

const connection = connectionMock();
const staff = authUser({ id: 9, roles: ["ARBITRE"] });
const caster = authUser({ id: 4, roles: ["CASTER"] });

beforeEach(() => {
  jest.clearAllMocks();
  resetPlanningMembersCache();
  jest.mocked(withConnection).mockImplementation(<T>(run: (c: PoolConnection) => Promise<T>) => run(fakeConnection(connection)));
  jest.mocked(loadPlanningMembers).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"] })]);
  jest.mocked(loadSoloCasterIds).mockResolvedValue(new Set());
  jest.mocked(loadPlanningData).mockImplementation(async (_executor, options) =>
    planningData({ entries: [loadedEntry()], members: options.members ?? [] }),
  );
});

describe("loadPlanningView — comptes", () => {
  it("loadPlanningView_twoLoadsWithinTtl_usersScannedOnce", async () => {
    await loadPlanningView(caster, MONDAY);
    await loadPlanningView(caster, MONDAY + PLANNING_MEMBERS_TTL_MS - 1);

    expect(loadPlanningMembers).toHaveBeenCalledTimes(1);
  });

  it("loadPlanningView_afterTtl_usersScannedAgain", async () => {
    await loadPlanningView(caster, MONDAY);
    await loadPlanningView(caster, MONDAY + PLANNING_MEMBERS_TTL_MS);

    expect(loadPlanningMembers).toHaveBeenCalledTimes(2);
  });

  it("loadPlanningView_clockGoesBack_copyNotTrusted", async () => {
    await loadPlanningView(caster, MONDAY);
    await loadPlanningView(caster, MONDAY - 1);

    expect(loadPlanningMembers).toHaveBeenCalledTimes(2);
  });

  it("loadPlanningView_soloSetting_readEveryTimeEvenWhenUsersCached", async () => {
    await loadPlanningView(caster, MONDAY);
    jest.mocked(loadSoloCasterIds).mockResolvedValue(new Set([4]));

    const view = await loadPlanningView(caster, MONDAY + 1000);

    expect(view.members.find((member) => member.userId === 4)?.soloCaster).toBe(true);
    expect(loadPlanningMembers).toHaveBeenCalledTimes(1);
  });

  it("loadPlanningView_cachedUsers_notMutatedBySoloMerge", async () => {
    jest.mocked(loadSoloCasterIds).mockResolvedValue(new Set([4]));
    await loadPlanningView(caster, MONDAY);
    jest.mocked(loadSoloCasterIds).mockResolvedValue(new Set());

    const view = await loadPlanningView(caster, MONDAY + 1000);

    expect(view.members[0].soloCaster).toBe(false);
  });

  it("loadPlanningView_passesCachedUsersToTheLoad", async () => {
    await loadPlanningView(caster, MONDAY);

    expect(jest.mocked(loadPlanningData).mock.calls[0][1].members).toEqual([expect.objectContaining({ userId: 4 })]);
  });
});

describe("loadPlanningView — disponibilités", () => {
  const rows: LoadedAvailability[] = [
    { entryKey: "m:1", userId: 4, role: "CASTER", status: "AVAILABLE", preferred: true },
    { entryKey: "m:1", userId: 5, role: "PROD", status: "PENDING", preferred: false },
    { entryKey: "m:2", userId: 4, role: "CASTER", status: "UNAVAILABLE", preferred: false },
  ];

  beforeEach(() => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry({ key: "m:1", matchId: 1 }), loadedEntry({ key: "m:2", matchId: 2 })],
        availability: rows,
        members: [loadedMember({ userId: 4, roles: ["CASTER"] })],
      }),
    );
  });

  it("loadPlanningView_staff_everyoneAvailabilityPerEntry", async () => {
    const view = await loadPlanningView(staff, MONDAY);

    expect(view.entries.map((entry) => entry.availability.length)).toEqual([2, 1]);
    expect(view.entries[0].mine).toEqual([]);
  });

  it("loadPlanningView_nonStaff_onlyOwnAvailability", async () => {
    const view = await loadPlanningView(caster, MONDAY);

    expect(view.entries.map((entry) => entry.availability)).toEqual([[], []]);
    expect(view.entries.map((entry) => entry.mine.map((row) => row.status))).toEqual([["AVAILABLE"], ["UNAVAILABLE"]]);
  });

  it("loadPlanningView_entryWithoutRows_emptyLists", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()] }));

    const view = await loadPlanningView(staff, MONDAY);

    expect(view.entries[0].mine).toEqual([]);
    expect(view.entries[0].availability).toEqual([]);
  });

  it("loadPlanningView_durations_comeFromTheLoad", async () => {
    const data = planningData({ entries: [loadedEntry()] });
    jest.mocked(loadPlanningData).mockResolvedValue(data);

    const view = await loadPlanningView(staff, MONDAY);

    expect(view.durations).toBe(data.durations);
  });
});
