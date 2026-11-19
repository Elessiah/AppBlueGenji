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
import { clearEntryRoundCache } from "@/lib/server/planning/round-names";
import { loadPlanningData, loadPlanningMembers, loadPlanningMembersByIds, type LoadedAvailability, type LoadedWithdrawal } from "@/lib/server/planning/load";
import {
  loadPlanningView,
  PLANNING_MEMBERS_TTL_MS,
  resetPlanningMembersCache,
  unfilledRoles,
  entryConfirmState,
  entriesNeedingMark,
  visibleAssignment,
} from "@/lib/server/planning/view";
import type { PlanningAssignmentView } from "@/lib/shared/planning-view";
import { authUser } from "../../../helpers/auth-user";
import { HOUR_MS, loadedAssignment, loadedEntry, loadedMember, MONDAY, planningData } from "../../../helpers/planning";
import { connectionMock, fakeConnection } from "../../../helpers/sql-double";

/** La page « Planning » : copie brève des comptes, réglage autonome relu, disponibilités regroupées (`CAST_PLANNING.md`). */

const connection = connectionMock();
const staff = authUser({ id: 9, roles: ["ARBITRE"] });
const caster = authUser({ id: 4, roles: ["CASTER"] });
const admin = authUser({ id: 1, isAdmin: true });

beforeEach(() => {
  jest.clearAllMocks();
  resetPlanningMembersCache();
  jest.mocked(withConnection).mockImplementation(<T>(run: (c: PoolConnection) => Promise<T>) => run(fakeConnection(connection)));
  connection.execute.mockResolvedValue([[], []]);
  jest.mocked(loadPlanningMembers).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"] })]);
  jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"] })]);
  jest.mocked(loadPlanningData).mockImplementation(async (_executor, options) =>
    planningData({ entries: [loadedEntry()], members: options.members ?? [] }),
  );
});

describe("entryConfirmState", () => {
  const HOUR = 60 * 60 * 1000;
  const startAt = MONDAY + 48 * HOUR;
  const confirmIso = new Date(startAt - 24 * HOUR).toISOString();

  it("entryConfirmState_openEntryBeforeConfirm_returnsIsoNotPending", () => {
    expect(entryConfirmState({ open: true, startAt, deadlineAt: null }, 24, MONDAY, true)).toEqual({ confirmAt: confirmIso, confirmPending: false });
  });

  it("entryConfirmState_confirmTimeReachedNothingProvisional_returnsNull", () => {
    expect(entryConfirmState({ open: true, startAt, deadlineAt: null }, 24, startAt - 24 * HOUR, false)).toEqual({
      confirmAt: null,
      confirmPending: false,
    });
  });

  it("entryConfirmState_confirmTimeReachedStillProvisional_pending", () => {
    expect(entryConfirmState({ open: true, startAt, deadlineAt: null }, 24, startAt - 24 * HOUR, true)).toEqual({
      confirmAt: confirmIso,
      confirmPending: true,
    });
  });

  it("entryConfirmState_closedEntry_returnsNull", () => {
    expect(entryConfirmState({ open: false, startAt, deadlineAt: null }, 24, MONDAY, true)).toEqual({ confirmAt: null, confirmPending: false });
  });
});

describe("loadPlanningView — noms hors membres", () => {
  it("loadPlanningView_nonMemberAssignee_nameReturned", async () => {
    jest.mocked(loadPlanningData).mockImplementation(async (_executor, options) =>
      planningData({ entries: [loadedEntry()], members: options.members ?? [], assignments: [loadedAssignment({ userId: 12, role: "CASTER" })] }),
    );
    connection.execute.mockImplementation(async (sql: string) =>
      sql.includes("SELECT id, pseudo FROM bg_users") ? [[{ id: 12, pseudo: "Test_CasterInvite" }], []] : [[], []],
    );

    const view = await loadPlanningView(staff, MONDAY);

    expect(view.names).toEqual([{ userId: 12, pseudo: "Test_CasterInvite" }]);
  });

  it("loadPlanningView_onlyMembers_noNamesField", async () => {
    const view = await loadPlanningView(caster, MONDAY);

    expect(view).not.toHaveProperty("names");
    expect(connection.execute.mock.calls.some(([sql]) => String(sql).includes("SELECT id, pseudo FROM bg_users"))).toBe(false);
  });
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

  it("loadPlanningView_suspendedMember_flagNotSentToPage", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"], seesHidden: false, suspended: true })]);

    const view = await loadPlanningView(staff, MONDAY);

    expect(view.members[0]).not.toHaveProperty("suspended");
  });

  it("loadPlanningView_admin_canComputeWithDurations", async () => {
    const view = await loadPlanningView(admin, MONDAY);

    expect(view.canCompute).toBe(true);
    expect(view.durations).toBeDefined();
  });

  it("loadPlanningView_tournamentsStaff_canManageButNotComputeNoDurations", async () => {
    const view = await loadPlanningView(staff, MONDAY);

    expect(view.canManage).toBe(true);
    expect(view.canCompute).toBe(false);
    expect(view).not.toHaveProperty("durations");
  });

  it("loadPlanningView_caster_cannotComputeNoDurations", async () => {
    const view = await loadPlanningView(caster, MONDAY);

    expect(view.canCompute).toBe(false);
    expect(view).not.toHaveProperty("durations");
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

    const view = await loadPlanningView(admin, MONDAY);

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

describe("loadPlanningView — caster autonome suspendu", () => {
  beforeEach(() => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        assignments: [loadedAssignment({ userId: 4, role: "CASTER", confirmed: true })],
        members: [loadedMember({ userId: 4, roles: ["CASTER"], soloCaster: true, suspended: true })],
      }),
    );
  });

  it("loadPlanningView_suspendedSoloCaster_staffCoverageNotStreamed", async () => {
    const view = await loadPlanningView(staff, MONDAY);

    // Pour le staff, le compte suspendu ne tient rien : ni diffusion, ni caster qui attendrait son prod.
    expect(view.entries[0].coverage).toMatchObject({ streamed: false, casterNeedsProd: false });
  });

  it("loadPlanningView_suspendedSoloCaster_memberCoverageUnchanged", async () => {
    const view = await loadPlanningView(caster, MONDAY);

    expect(view.entries[0].coverage).toMatchObject({ streamed: true, casterNeedsProd: false });
  });
});

describe("loadPlanningView — caster non autonome suspendu", () => {
  beforeEach(() => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        assignments: [
          loadedAssignment({ userId: 4, role: "CASTER", confirmed: true }),
          loadedAssignment({ userId: 7, role: "PROD", confirmed: true }),
        ],
        members: [loadedMember({ userId: 4, roles: ["CASTER"], suspended: true }), loadedMember({ userId: 7, roles: ["PROD"] })],
      }),
    );
  });

  it("loadPlanningView_suspendedCasterStaff_coverageIgnoresRow", async () => {
    const view = await loadPlanningView(staff, MONDAY);

    expect(view.entries[0].coverage).toMatchObject({ streamed: false });
  });

  it("loadPlanningView_suspendedCasterMember_coverageKeepsRow", async () => {
    const view = await loadPlanningView(caster, MONDAY);

    expect(view.entries[0].coverage).toMatchObject({ streamed: true });
  });
});

describe("loadPlanningView — place quittée tenue par un compte suspendu", () => {
  beforeEach(() => {
    // 5 s'est désisté (confirmé) ; seul 4, suspendu, reste caster.
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        assignments: [loadedAssignment({ userId: 4, role: "CASTER", confirmed: true })],
        members: [loadedMember({ userId: 4, roles: ["CASTER"], suspended: true })],
        withdrawals: [withdrawalRow({ userId: 5 })],
      }),
    );
  });

  it("loadPlanningView_suspendedRemainingCaster_staffSeesUnfilled", async () => {
    const view = await loadPlanningView(staff, MONDAY - 48 * 60 * 60 * 1000);

    expect(view.entries[0].unfilled).toEqual(["CASTER"]);
  });

  it("loadPlanningView_suspendedRemainingCaster_memberSeesHeld", async () => {
    const view = await loadPlanningView(caster, MONDAY - 48 * 60 * 60 * 1000);

    expect(view.entries[0].unfilled).toEqual([]);
  });
});

describe("entriesNeedingMark", () => {
  const startAt = MONDAY + 48 * HOUR_MS;
  const pending = new Map([["m:1", { REFEREE: 1 }]]);
  const confirmTime = startAt - 24 * HOUR_MS;

  it("entriesNeedingMark_openPastConfirmWithPending_included", () => {
    expect(entriesNeedingMark([loadedEntry({ startAt })], pending, 24, confirmTime)).toEqual(["m:1"]);
  });

  it("entriesNeedingMark_confirmTimeAhead_excluded", () => {
    expect(entriesNeedingMark([loadedEntry({ startAt })], pending, 24, confirmTime - 1)).toEqual([]);
  });

  it("entriesNeedingMark_noPendingRows_excluded", () => {
    expect(entriesNeedingMark([loadedEntry({ startAt })], new Map(), 24, confirmTime)).toEqual([]);
  });

  it("entriesNeedingMark_closedEntry_excluded", () => {
    expect(entriesNeedingMark([loadedEntry({ startAt, open: false })], pending, 24, confirmTime)).toEqual([]);
  });
});

describe("loadPlanningView — confirmation d'office", () => {
  const startAt = MONDAY + 48 * HOUR_MS;
  const confirmTime = startAt - 24 * HOUR_MS;
  const marksQuery = /FROM bg_planning_auto_confirms/;

  function withProvisionalReferee(): void {
    jest.mocked(loadPlanningData).mockImplementation(async (_executor, options) =>
      planningData({ entries: [loadedEntry({ startAt })], assignments: [loadedAssignment()], members: options.members ?? [] }),
    );
  }

  function marksCalls() {
    return connection.execute.mock.calls.filter(([sql]) => marksQuery.test(String(sql)));
  }

  it("loadPlanningView_noEntryNeedsMark_marksNotQueried", async () => {
    withProvisionalReferee();

    await loadPlanningView(staff, confirmTime - 1);

    expect(marksCalls()).toHaveLength(0);
  });

  it("loadPlanningView_leftoverAlreadyAttempted_notPending", async () => {
    withProvisionalReferee();
    connection.execute.mockImplementation(async (sql: string) =>
      marksQuery.test(sql) ? [[{ entry_key: "m:1", start_at: new Date(startAt), pending_roles: '{"REFEREE":1}' }], []] : [[], []],
    );

    const view = await loadPlanningView(staff, confirmTime);

    expect(marksCalls()[0][1]).toEqual(["m:1"]);
    expect(view.entries[0].confirmPending).toBe(false);
  });

  it("loadPlanningView_unconfirmedRowWithoutMark_pending", async () => {
    withProvisionalReferee();

    const view = await loadPlanningView(staff, confirmTime);

    expect(view.entries[0].confirmPending).toBe(true);
  });
});

describe("loadPlanningView — nom du tour", () => {
  const roundsQuery = /FROM bg_matches m JOIN bg_tournaments/;
  const finalRows = [
    { id: 1, tournament_id: 10, phase_id: 0, bracket: "UPPER", round_number: 1, match_number: 1, status: "COMPLETED", double_forfeit: 0, format: "SINGLE", state: "RUNNING" },
    { id: 2, tournament_id: 10, phase_id: 0, bracket: "UPPER", round_number: 1, match_number: 2, status: "COMPLETED", double_forfeit: 0, format: "SINGLE", state: "RUNNING" },
    { id: 3, tournament_id: 10, phase_id: 0, bracket: "UPPER", round_number: 2, match_number: 1, status: "PENDING", double_forfeit: 0, format: "SINGLE", state: "RUNNING" },
  ];

  beforeEach(() => clearEntryRoundCache());

  function withEntries(entries: ReturnType<typeof loadedEntry>[], rows: object[]): void {
    jest.mocked(loadPlanningData).mockImplementation(async (_executor, options) => planningData({ entries, members: options.members ?? [] }));
    connection.execute.mockImplementation(async (sql: string) => (roundsQuery.test(sql) ? [rows, []] : [[], []]));
  }

  it("loadPlanningView_matchEntry_carriesRoundOfItsMatchAndNumber", async () => {
    withEntries([loadedEntry({ key: "m:3", matchId: 3, roundNumber: 2 })], finalRows);

    const view = await loadPlanningView(caster, MONDAY);

    expect(view.entries[0].round).toEqual({ kind: "stage", stage: "final", lower: false, round: 2 });
    expect(view.entries[0].matchNumber).toBe(1);
  });

  it("loadPlanningView_tournamentEntry_hasNoRoundAndRunsNoRoundQuery", async () => {
    withEntries([loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null, roundNumber: null })], finalRows);

    const view = await loadPlanningView(caster, MONDAY);

    expect(view.entries[0].round).toBeNull();
    expect(view.entries[0].matchNumber).toBeNull();
    expect(connection.execute.mock.calls.some(([sql]) => roundsQuery.test(String(sql)))).toBe(false);
  });

  it("loadPlanningView_matchMissingFromRounds_hasNullRoundAndNumber", async () => {
    withEntries([loadedEntry({ key: "m:99", matchId: 99, roundNumber: 2 })], finalRows);

    const view = await loadPlanningView(caster, MONDAY);

    expect(view.entries[0].round).toBeNull();
    expect(view.entries[0].matchNumber).toBeNull();
  });

  it("loadPlanningView_twoLoadsWithinTtl_readTheRoundsOnce", async () => {
    withEntries([loadedEntry({ key: "m:3", matchId: 3, roundNumber: 2 })], finalRows);

    const first = await loadPlanningView(caster, MONDAY);
    const second = await loadPlanningView(caster, MONDAY + 1000);

    expect(second.entries[0].round).toEqual(first.entries[0].round);
    expect(connection.execute.mock.calls.filter(([sql]) => roundsQuery.test(String(sql)))).toHaveLength(1);
  });
});
