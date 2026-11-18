import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/planning/load", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/load")>("@/lib/server/planning/load"),
  loadPlanningData: jest.fn(),
  loadPlanningMembers: jest.fn(),
  loadPlanningMembersByIds: jest.fn(),
}));

import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { loadPlanningData, loadPlanningMembers, loadPlanningMembersByIds, type LoadedAvailability, type LoadedWithdrawal } from "@/lib/server/planning/load";
import { loadPlanningView, PLANNING_MEMBERS_TTL_MS, resetPlanningMembersCache, unfilledRoles, visibleAssignment } from "@/lib/server/planning/view";
import type { PlanningAssignmentView } from "@/lib/shared/planning-view";
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
  jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"] })]);
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

  it("loadPlanningView_withinTtl_cachedIdsReadAgainByKey", async () => {
    await loadPlanningView(caster, MONDAY);

    await loadPlanningView(caster, MONDAY + 1000);

    expect(loadPlanningMembersByIds).toHaveBeenCalledTimes(1);
    expect(jest.mocked(loadPlanningMembersByIds).mock.calls[0][1]).toEqual([4]);
  });

  it("loadPlanningView_memberLostRoleWithinTtl_droppedOnNextLoad", async () => {
    await loadPlanningView(caster, MONDAY);
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([]);

    const view = await loadPlanningView(caster, MONDAY + 1000);

    expect(view.members).toEqual([]);
  });

  it("loadPlanningView_soloSettingWithinTtl_freshValue", async () => {
    await loadPlanningView(caster, MONDAY);
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"], soloCaster: true })]);

    const view = await loadPlanningView(caster, MONDAY + 1000);

    expect(view.members[0].soloCaster).toBe(true);
  });

  it("loadPlanningView_members_serverOnlyFieldsLeftOut", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"], seesHidden: false })]);

    const view = await loadPlanningView(caster, MONDAY);

    expect(view.members).toEqual([{ userId: 4, pseudo: "Membre", roles: ["CASTER"], soloCaster: false }]);
  });

  it("loadPlanningView_staff_membersCarrySeesHidden", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"], seesHidden: false })]);

    const view = await loadPlanningView(staff, MONDAY);

    expect(view.canManage).toBe(true);
    expect(view.members).toEqual([{ userId: 4, pseudo: "Membre", roles: ["CASTER"], soloCaster: false, seesHidden: false }]);
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

  it("loadPlanningView_nonStaff_readsOnlyOwnAvailabilityFromDatabase", async () => {
    await loadPlanningView(caster, MONDAY);

    expect(jest.mocked(loadPlanningData).mock.calls[0][1].availabilityOf).toBe(4);
  });

  it("loadPlanningView_staff_readsEveryoneAvailability", async () => {
    await loadPlanningView(staff, MONDAY);

    expect(jest.mocked(loadPlanningData).mock.calls[0][1].availabilityOf).toBeUndefined();
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

describe("visibleAssignment", () => {
  const preference: PlanningAssignmentView = { userId: 5, role: "CASTER", source: "AUTO", reason: "PREFERENCE", provisional: true };

  it("visibleAssignment_staff_keepsPreference", () => {
    expect(visibleAssignment(preference, 9, true).reason).toBe("PREFERENCE");
  });

  it("visibleAssignment_ownRow_keepsPreference", () => {
    expect(visibleAssignment(preference, 5, false).reason).toBe("PREFERENCE");
  });

  it("visibleAssignment_otherMemberPreference_becomesAuto", () => {
    expect(visibleAssignment(preference, 4, false).reason).toBe("AUTO");
  });

  it("visibleAssignment_otherMemberLoad_becomesAuto", () => {
    expect(visibleAssignment({ ...preference, reason: "LOAD" }, 4, false).reason).toBe("AUTO");
  });

  it("visibleAssignment_unknownReasonForOther_maskedAsAuto", () => {
    // Un motif encore inconnu de la liste blanche (ajouté plus tard au type).
    const future = { ...preference, reason: String("AVAILABLE_ONLY") as PlanningAssignmentView["reason"] };

    expect(visibleAssignment(future, 4, false).reason).toBe("AUTO");
  });

  it("visibleAssignment_otherMemberCastOrMatch_unchanged", () => {
    expect(visibleAssignment({ ...preference, reason: "CAST" }, 4, false).reason).toBe("CAST");
    expect(visibleAssignment({ ...preference, reason: "MATCH" }, 4, false).reason).toBe("MATCH");
  });

  it("visibleAssignment_otherMemberManual_unchanged", () => {
    expect(visibleAssignment({ ...preference, source: "MANUAL", reason: "MANUAL" }, 4, false).reason).toBe("MANUAL");
  });
});

describe("loadPlanningView — raisons", () => {
  it("loadPlanningView_casterReadsOtherPreference_shownAsAuto", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry({ key: "m:1", matchId: 1 })],
        assignments: [{ entryKey: "m:1", userId: 6, role: "PROD", source: "AUTO", reason: "PREFERENCE", confirmed: false }],
      }),
    );

    const view = await loadPlanningView(caster, MONDAY);

    expect(view.entries[0].assignments.map((row) => row.reason)).toEqual(["AUTO"]);
  });
});

/** Un désistement tel que le relit `loadPlanningData`. */
function withdrawalRow(overrides: Partial<LoadedWithdrawal> = {}): LoadedWithdrawal {
  return { entryKey: "m:1", userId: 4, role: "CASTER", reason: "Malade", late: true, confirmed: true, createdAt: "2026-11-20T10:00:00.000Z", ...overrides };
}

const heldBy = (userId: number, provisional: boolean): PlanningAssignmentView => ({
  userId,
  role: "CASTER",
  source: "AUTO",
  reason: "LOAD",
  provisional,
});

describe("unfilledRoles", () => {
  it("unfilledRoles_confirmedWithdrawalNoHolder_listsRole", () => {
    expect(unfilledRoles({ editable: true }, [], [withdrawalRow()])).toEqual(["CASTER"]);
  });

  it("unfilledRoles_onlyProvisionalHolder_stillOpen", () => {
    expect(unfilledRoles({ editable: true }, [heldBy(6, true)], [withdrawalRow()])).toEqual(["CASTER"]);
  });

  it("unfilledRoles_confirmedHolder_notOpen", () => {
    expect(unfilledRoles({ editable: true }, [heldBy(6, false)], [withdrawalRow()])).toEqual([]);
  });

  it("unfilledRoles_provisionalWithdrawal_ignored", () => {
    expect(unfilledRoles({ editable: true }, [], [withdrawalRow({ confirmed: false })])).toEqual([]);
  });

  it("unfilledRoles_entryClosed_empty", () => {
    expect(unfilledRoles({ editable: false }, [], [withdrawalRow()])).toEqual([]);
  });
});

describe("loadPlanningView — désistements", () => {
  beforeEach(() => {
    jest.mocked(loadPlanningData).mockImplementation(async (_executor, options) =>
      planningData({ entries: [loadedEntry()], members: options.members ?? [], withdrawals: [withdrawalRow()] }),
    );
  });

  it("loadPlanningView_staff_seesWithdrawalReasons", async () => {
    const view = await loadPlanningView(staff, MONDAY - 48 * 60 * 60 * 1000);

    expect(view.entries[0].withdrawals).toEqual([
      { userId: 4, role: "CASTER", late: true, reason: "Malade", confirmed: true, createdAt: "2026-11-20T10:00:00.000Z" },
    ]);
    expect(view.entries[0].unfilled).toEqual(["CASTER"]);
  });

  it("loadPlanningView_caster_seesOpenSlotButNoWithdrawals", async () => {
    const view = await loadPlanningView(caster, MONDAY - 48 * 60 * 60 * 1000);

    expect(view.entries[0].withdrawals).toEqual([]);
    expect(view.entries[0].unfilled).toEqual(["CASTER"]);
  });
});
