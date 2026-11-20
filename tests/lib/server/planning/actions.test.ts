import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/named-lock", () => ({
  ...jest.requireActual<typeof import("@/lib/server/named-lock")>("@/lib/server/named-lock"),
  withNamedLock: jest.fn(),
}));
jest.mock("@/lib/server/planning/load", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/load")>("@/lib/server/planning/load"),
  loadPlanningData: jest.fn(),
  loadPlanningEntries: jest.fn(),
  loadPlanningMembersByIds: jest.fn(),
  loadHiddenTournamentIds: jest.fn(),
}));
jest.mock("@/lib/server/planning/profiles");
jest.mock("@/lib/server/planning/notices");
jest.mock("@/lib/server/planning/cast-placement", () => ({ queuePlannedCasts: jest.fn(), releasePlannedSeat: jest.fn() }));
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
import { loadHiddenTournamentIds, loadPlanningData, loadPlanningEntries, loadPlanningMembersByIds } from "@/lib/server/planning/load";
import { queuePlannedCasts, releasePlannedSeat } from "@/lib/server/planning/cast-placement";
import { announceAssignments } from "@/lib/server/planning/notices";
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

const CREATED_AT = new Date("2026-11-16T19:00:00Z");
const EVENT_ID = 77;

/** Ligne `bg_planning_assignments` telle que la lit l'instantané d'un geste (`planning-undo.ts`). */
function assignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    entry_key: "m:1",
    user_id: 7,
    role: "REFEREE",
    tournament_id: 10,
    match_id: 1,
    source: "MANUAL",
    reason: "MANUAL",
    confirmed: 1,
    assigned_by_user_id: 9,
    created_at: CREATED_AT,
    ...overrides,
  };
}

/**
 * Base simulée : instantané des lignes, arbitre lu sur le match (avant la
 * désignation, puis relu après une panne : une liste donne les lectures dans
 * l'ordre, la dernière se répète), identifiant d'évènement.
 */
function routeSql(
  options: {
    rows?: Record<string, unknown>[];
    matchReferee?: number | null | (number | null)[];
    displaced?: number[];
    released?: number;
    readFails?: boolean;
    /** Les lectures du match (hors transaction) échouent après ce nombre de lectures réussies. */
    readFailsAfter?: number;
    /** L'arbitre du match lu dans la transaction du geste ; par défaut, la première lecture. */
    inTransaction?: number | null;
    /** La prod du match relue sous verrou dans la transaction du geste ; par défaut aucune. */
    matchProd?: number | null;
  } = {},
) {
  const reads = Array.isArray(options.matchReferee) ? [...options.matchReferee] : [options.matchReferee ?? null];
  const inTransaction = options.inTransaction === undefined ? (reads[0] ?? null) : options.inTransaction;
  let nextEventId = EVENT_ID;
  let matchReads = 0;
  execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT entry_key")) return [options.rows ?? [], []];
    if (sql.startsWith("SELECT user_id FROM bg_planning_assignments")) {
      return [(options.displaced ?? []).map((user_id) => ({ user_id })), []];
    }
    if (sql.includes("source = 'AUTO' AND confirmed = 0") && options.released !== undefined) {
      return [{ affectedRows: options.released }];
    }
    if (sql.startsWith("SELECT m.referee_user_id FROM bg_matches")) return [[{ referee_user_id: inTransaction }], []];
    if (sql.startsWith("SELECT id, prod_user_id FROM bg_matches")) return [[{ id: 1, prod_user_id: options.matchProd ?? null }], []];
    if (sql.includes("SELECT referee_user_id FROM bg_matches")) {
      matchReads += 1;
      if (options.readFails || (options.readFailsAfter !== undefined && matchReads > options.readFailsAfter)) {
        throw new Error("ER_CON_COUNT_ERROR");
      }
      const referee = reads.length > 1 ? reads.shift() : reads[0];
      return [[{ referee_user_id: referee ?? null }], []];
    }
    if (sql.includes("INSERT INTO bg_planning_events")) return [{ affectedRows: 1, insertId: nextEventId++ }];
    return [{ affectedRows: 1 }];
  });
}

/** Les requêtes jouées qui contiennent `fragment`. */
function callsWith(fragment: string) {
  return execute.mock.calls.filter(([sql]) => sql.includes(fragment));
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
  routeSql();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.mocked(loadEntryPlayers).mockResolvedValue(new Map());
  jest.mocked(assignMatchReferee).mockResolvedValue(undefined);
  jest.mocked(writeSoloCaster).mockResolvedValue(true);
  // Relecture verrouillée dans la transaction : par défaut, chacun tient tous les rôles et voit tout.
  jest.mocked(loadPlanningMembersByIds).mockImplementation(async (_executor, ids) =>
    ids.map((userId) => loadedMember({ userId, roles: ["REFEREE", "CASTER", "PROD"], seesHidden: true })),
  );
  jest.mocked(loadHiddenTournamentIds).mockResolvedValue(new Set());
});

describe("setAvailability", () => {
  it("setAvailability_roleNotHeld_throwsRoleNotHeld", async () => {
    await expect(setAvailability(prod, { entryKey: "m:1", role: "CASTER", status: "AVAILABLE", preferred: false })).rejects.toThrow(
      "PLANNING_ROLE_NOT_HELD",
    );
    expect(loadPlanningData).not.toHaveBeenCalled();
  });

  it("setAvailability_unknownEntry_throwsNotFound", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([]);

    await expect(setAvailability(prod, { entryKey: "m:1", role: "PROD", status: "AVAILABLE", preferred: false })).rejects.toThrow(
      "PLANNING_ENTRY_NOT_FOUND",
    );
  });

  it("setAvailability_malformedKey_notFoundWithoutReadingAnything", async () => {
    await expect(setAvailability(prod, { entryKey: "x:1; DROP", role: "PROD", status: "AVAILABLE", preferred: false })).rejects.toThrow(
      "PLANNING_ENTRY_NOT_FOUND",
    );
    expect(loadPlanningEntries).not.toHaveBeenCalled();
  });

  it("setAvailability_closedEntry_throwsClosed", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ open: false })]);

    await expect(setAvailability(prod, { entryKey: "m:1", role: "PROD", status: "AVAILABLE", preferred: false })).rejects.toThrow(
      "PLANNING_ENTRY_CLOSED",
    );
  });

  it("setAvailability_valid_upserts", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry()]);

    await setAvailability(prod, { entryKey: "m:1", role: "PROD", status: "PENDING", preferred: true });

    expect(execute.mock.calls[0][1]).toEqual(["m:1", "PROD", 10, 1, "PENDING", 1, 6]);
  });

  it("setAvailability_valid_insertsOnlyForANonGuestAccount", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry()]);

    await setAvailability(prod, { entryKey: "m:1", role: "PROD", status: "AVAILABLE", preferred: false });

    expect(execute.mock.calls[0][0]).toMatch(/INSERT INTO bg_planning_availability[\s\S]*SELECT[\s\S]*FROM bg_users u WHERE u\.id = \? AND u\.is_guest_staff = 0/);
  });

  it("setAvailability_readsOnlyThatEntry_neverTheWholePlanning", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry()]);

    await setAvailability(prod, { entryKey: "m:1", role: "PROD", status: "AVAILABLE", preferred: false });

    expect(loadPlanningData).not.toHaveBeenCalled();
    expect(loadPlanningMembersByIds).not.toHaveBeenCalled();
    expect(jest.mocked(loadPlanningEntries).mock.calls[0][1]).toMatchObject({ only: { kind: "MATCH", id: 1 } });
  });

  it("setAvailability_tournamentKey_readsTheTournamentEntry", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry({ key: "t:5", kind: "TOURNAMENT", matchId: null })]);

    await setAvailability(prod, { entryKey: "t:5", role: "PROD", status: "AVAILABLE", preferred: false });

    expect(jest.mocked(loadPlanningEntries).mock.calls[0][1]).toMatchObject({ only: { kind: "TOURNAMENT", id: 5 } });
  });

  it("setAvailability_nonStaff_hiddenTournamentsNotLoaded", async () => {
    jest.mocked(loadPlanningEntries).mockResolvedValue([loadedEntry()]);

    await setAvailability(prod, { entryKey: "m:1", role: "PROD", status: "AVAILABLE", preferred: false });

    expect(jest.mocked(loadPlanningEntries).mock.calls[0][1]).toMatchObject({ includeHidden: false });
  });
});

describe("setSoloCaster", () => {
  it("setSoloCaster_writeChanged_returnsTrue", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"] })]);

    await expect(setSoloCaster(4, true)).resolves.toBe(true);
  });

  it("setSoloCaster_writeUnchanged_returnsFalse", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"] })]);
    jest.mocked(writeSoloCaster).mockResolvedValue(false);

    await expect(setSoloCaster(4, true)).resolves.toBe(false);
  });

  it("setSoloCaster_notCaster_throwsNotCaster", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 6, roles: ["PROD"] })]);

    await expect(setSoloCaster(6, true)).rejects.toThrow("NOT_CASTER");
    expect(writeSoloCaster).not.toHaveBeenCalled();
  });

  it("setSoloCaster_accountGoneOrRoleless_throwsNotCaster", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([]);

    await expect(setSoloCaster(7, true)).rejects.toThrow("NOT_CASTER");
    expect(writeSoloCaster).not.toHaveBeenCalled();
  });

  it("setSoloCaster_suspendedCasterSet_throwsNotCasterWithoutWriting", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"], suspended: true })]);

    await expect(setSoloCaster(4, true)).rejects.toThrow("NOT_CASTER");
    expect(writeSoloCaster).not.toHaveBeenCalled();
  });

  it("setSoloCaster_suspendedCasterClear_writesFalse", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"], suspended: true })]);

    await setSoloCaster(4, false);

    expect(writeSoloCaster).toHaveBeenCalledWith(expect.anything(), 4, false);
  });

  it("setSoloCaster_nonCasterClear_throwsNotCaster", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 6, roles: ["PROD"] })]);

    await expect(setSoloCaster(6, false)).rejects.toThrow("NOT_CASTER");
    expect(writeSoloCaster).not.toHaveBeenCalled();
  });

  it("setSoloCaster_missingAccountClear_throwsNotCaster", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([]);

    await expect(setSoloCaster(7, false)).rejects.toThrow("NOT_CASTER");
    expect(writeSoloCaster).not.toHaveBeenCalled();
  });

  it("setSoloCaster_caster_readsOnlyTargetAndWrites", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"] })]);

    await setSoloCaster(4, true);

    expect(jest.mocked(loadPlanningMembersByIds).mock.calls[0][1]).toEqual([4]);
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

  it("setManualAssignment_hiddenEntryMemberWithoutTournaments_throwsHidden", async () => {
    const hidden = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null, hidden: true });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [hidden], members }));

    await expect(setManualAssignment(staff, { entryKey: "t:10", role: "PROD", userId: 6, assigned: true })).rejects.toThrow(
      "PLANNING_HIDDEN_FOR_MEMBER",
    );
    expect(callsWith("INSERT INTO bg_planning_assignments")).toEqual([]);
  });

  it("setManualAssignment_hiddenEntryMemberSeesHidden_writes", async () => {
    const hidden = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null, hidden: true });
    const seer = loadedMember({ userId: 6, roles: ["PROD"], seesHidden: true });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [hidden], members: [seer] }));

    await setManualAssignment(staff, { entryKey: "t:10", role: "PROD", userId: 6, assigned: true });

    expect(callsWith("INSERT INTO bg_planning_assignments")).toHaveLength(1);
  });

  it("setManualAssignment_newAssignment_announcedToAssigneeNotActor", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [event], members: [loadedMember({ userId: 6, roles: ["PROD"] })] }));

    await setManualAssignment(staff, { entryKey: "t:10", role: "PROD", userId: 6, assigned: true });

    expect(jest.mocked(announceAssignments).mock.calls[0]).toEqual([[{ userId: 6, entry: event, role: "PROD" }], { actorId: 9 }]);
  });

  it("setManualAssignment_newAssignment_placedOnMatchWithStaffNamed", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [event], members: [loadedMember({ userId: 6, roles: ["PROD"] })] }));

    await setManualAssignment(staff, { entryKey: "t:10", role: "PROD", userId: 6, assigned: true });

    expect(queuePlannedCasts).toHaveBeenCalledWith([{ userId: 6, entry: event, role: "PROD" }], { id: 9, pseudo: staff.pseudo });
  });

  it("setManualAssignment_placementPending_returnsWithoutWaiting", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [event], members: [loadedMember({ userId: 6, roles: ["PROD"] })] }));
    jest.mocked(queuePlannedCasts).mockReturnValue(new Promise(() => undefined));

    await expect(setManualAssignment(staff, { entryKey: "t:10", role: "PROD", userId: 6, assigned: true })).resolves.toBeUndefined();
  });

  it("setManualAssignment_removal_notPlaced", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [event],
        members: [loadedMember({ userId: 6, roles: ["PROD"] })],
        assignments: [loadedAssignment({ entryKey: "t:10", userId: 6, role: "PROD", confirmed: true })],
      }),
    );

    await setManualAssignment(staff, { entryKey: "t:10", role: "PROD", userId: 6, assigned: false });

    expect(queuePlannedCasts).not.toHaveBeenCalled();
  });

  it("setManualAssignment_removalConfirmed_releasesPlannedSeatByStaff", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        members: [loadedMember({ userId: 6, roles: ["PROD"] })],
        assignments: [loadedAssignment({ userId: 6, role: "PROD", confirmed: true })],
      }),
    );

    await setManualAssignment(staff, { entryKey: "m:1", role: "PROD", userId: 6, assigned: false });

    expect(releasePlannedSeat).toHaveBeenCalledWith(expect.objectContaining({ key: "m:1" }), 6, "PROD", expect.objectContaining({ id: staff.id }));
  });

  it("setManualAssignment_removalProvisional_noPlannedSeatRelease", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        members: [loadedMember({ userId: 6, roles: ["PROD"] })],
        assignments: [loadedAssignment({ userId: 6, role: "PROD", confirmed: false })],
      }),
    );

    await setManualAssignment(staff, { entryKey: "m:1", role: "PROD", userId: 6, assigned: false });

    expect(releasePlannedSeat).not.toHaveBeenCalled();
  });

  it("setManualAssignment_removal_notAnnounced", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [event],
        members: [loadedMember({ userId: 6, roles: ["PROD"] })],
        assignments: [loadedAssignment({ entryKey: "t:10", userId: 6, role: "PROD", confirmed: true })],
      }),
    );

    await setManualAssignment(staff, { entryKey: "t:10", role: "PROD", userId: 6, assigned: false });

    expect(announceAssignments).not.toHaveBeenCalled();
  });

  it("setManualAssignment_roleLostUnderLock_rollsBackWithoutWriting", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [event], members }));
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([]);

    await expect(setManualAssignment(staff, { entryKey: "t:10", role: "PROD", userId: 6, assigned: true })).rejects.toThrow(
      "PLANNING_ROLE_NOT_HELD",
    );
    expect(jest.mocked(loadPlanningMembersByIds).mock.calls[0][2]).toEqual({ lock: true });
    expect(callsWith("INSERT INTO bg_planning_assignments")).toEqual([]);
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("setManualAssignment_tournamentRehiddenUnderLock_throwsHidden", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [event], members }));
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 6, roles: ["PROD"], seesHidden: false })]);
    jest.mocked(loadHiddenTournamentIds).mockResolvedValue(new Set([10]));

    await expect(setManualAssignment(staff, { entryKey: "t:10", role: "PROD", userId: 6, assigned: true })).rejects.toThrow(
      "PLANNING_HIDDEN_FOR_MEMBER",
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

  it("setManualAssignment_entryHasTwoCasters_throwsCastersFull", async () => {
    const casters = [...members, loadedMember({ userId: 7, roles: ["CASTER"] })];
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        members: casters,
        assignments: [loadedAssignment({ userId: 7, role: "CASTER", source: "MANUAL", confirmed: true })],
        matchCasters: new Map([["m:1", [8]]]),
      }),
    );

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true })).rejects.toThrow(
      "PLANNING_CASTERS_FULL",
    );
    expect(callsWith("INSERT INTO bg_planning_assignments")).toEqual([]);
  });

  it("setManualAssignment_entryHasOneCaster_secondCasterAssigned", async () => {
    const casters = [...members, loadedMember({ userId: 7, roles: ["CASTER"] })];
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [event],
        members: casters,
        assignments: [loadedAssignment({ entryKey: "t:10", userId: 7, role: "CASTER", source: "MANUAL", confirmed: true })],
      }),
    );

    await setManualAssignment(staff, { entryKey: "t:10", role: "CASTER", userId: 4, assigned: true });

    expect(callsWith("INSERT INTO bg_planning_assignments")[0][1]).toEqual(["t:10", 4, "CASTER", 10, null, "MANUAL", "MANUAL", 1, 9]);
  });

  it("setManualAssignment_castSource_throwsCastManaged", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [loadedEntry()], members, matchCasters: new Map([["m:1", [4]]]) }),
    );

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true })).rejects.toThrow(
      "PLANNING_CAST_MANAGED",
    );
  });

  it("setManualAssignment_matchReferee_planningCommittedBeforeDesignation", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ matchReferee: 7 });
    jest.mocked(assignMatchReferee).mockImplementation(async () => {
      expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true });

    expect(assignMatchReferee).toHaveBeenCalledWith(1, 9, 3, 7, { refuseSuspended: true });
    expect(callsWith("role = 'REFEREE' AND user_id <> ?")[0][1]).toEqual(["m:1", 3]);
    expect(callsWith("UPDATE bg_matches")).toEqual([]);
  });

  it("setManualAssignment_tournamentCaster_writesManualConfirmed", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [event], members }));

    await setManualAssignment(staff, { entryKey: "t:10", role: "CASTER", userId: 4, assigned: true });

    expect(assignMatchReferee).not.toHaveBeenCalled();
    expect(callsWith("INSERT INTO bg_planning_assignments")[0][1]).toEqual(["t:10", 4, "CASTER", 10, null, "MANUAL", "MANUAL", 1, 9]);
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

    expect(callsWith("source = 'AUTO' AND confirmed = 0")[0][1]).toEqual(["m:2", 4, "CASTER"]);
    expect(callsWith("INSERT INTO bg_planning_assignments")[0][1]).toEqual(["m:1", 4, "CASTER", 10, 1, "MANUAL", "MANUAL", 1, 9]);
  });

  it("setManualAssignment_releasedOverlappingProposal_writesRemovedAutoEvent", async () => {
    const other = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + HOUR_MS / 2, endAt: MONDAY + 2 * HOUR_MS });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry(), other],
        members,
        assignments: [loadedAssignment({ entryKey: "m:2", userId: 4, role: "CASTER" })],
      }),
    );

    await setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true });

    expect(callsWith("INSERT INTO bg_planning_events").map(([, params]) => params)).toEqual([
      ["m:2", 4, "CASTER", 10, 2, "REMOVED", "AUTO", 9],
      ["m:1", 4, "CASTER", 10, 1, "ASSIGNED", "MANUAL", 9],
    ]);
  });

  it("setManualAssignment_releasedProposalAlreadyGone_noRemovedEvent", async () => {
    const other = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + HOUR_MS / 2, endAt: MONDAY + 2 * HOUR_MS });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry(), other],
        members,
        assignments: [loadedAssignment({ entryKey: "m:2", userId: 4, role: "CASTER" })],
      }),
    );
    routeSql({ released: 0 });

    await setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true });

    expect(callsWith("INSERT INTO bg_planning_events").map(([, params]) => params)).toEqual([
      ["m:1", 4, "CASTER", 10, 1, "ASSIGNED", "MANUAL", 9],
    ]);
  });

  it("setManualAssignment_displacedMatchReferee_writesRemovedAutoEvent", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ matchReferee: 7, displaced: [7] });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true });

    expect(callsWith("FOR UPDATE")[0][1]).toEqual(["m:1", 3]);
    expect(callsWith("INSERT INTO bg_planning_events").map(([, params]) => params)).toEqual([
      ["m:1", 7, "REFEREE", 10, 1, "REMOVED", "AUTO", 9],
      ["m:1", 3, "REFEREE", 10, 1, "ASSIGNED", "MANUAL", 9],
    ]);
  });

  it("setManualAssignment_refereeCarriedByMatchOnly_writesRemovedAutoEvent", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ matchReferee: 7 });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true });

    expect(callsWith("INSERT INTO bg_planning_events").map(([, params]) => params)).toEqual([
      ["m:1", 7, "REFEREE", 10, 1, "REMOVED", "AUTO", 9],
      ["m:1", 3, "REFEREE", 10, 1, "ASSIGNED", "MANUAL", 9],
    ]);
  });

  it("setManualAssignment_refereeCarriedByMatchOnlyRefused_removalEventErased", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ matchReferee: 7 });
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("REFEREE_CHANGED"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "REFEREE_CHANGED",
    );
    expect(callsWith("DELETE FROM bg_planning_events")[0][1]).toEqual([EVENT_ID, EVENT_ID + 1]);
  });

  it("setManualAssignment_carriedReadInTransaction_removedEventForFreshReferee", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: null })], members }));
    routeSql({ matchReferee: null, inTransaction: 7 });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true });

    expect(callsWith("INSERT INTO bg_planning_events")[0][1]).toEqual(["m:1", 7, "REFEREE", 10, 1, "REMOVED", "AUTO", 9]);
  });

  it("setManualAssignment_matchGotWantedMemberMeanwhile_carriedEventErased", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ matchReferee: 3, inTransaction: 7 });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true });

    expect(assignMatchReferee).not.toHaveBeenCalled();
    expect(callsWith("DELETE FROM bg_planning_events")[0][1]).toEqual([EVENT_ID]);
  });

  it("setManualAssignment_uncertainOutcome_carriedEventErasedOthersKept", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ matchReferee: 7, readFailsAfter: 1 });
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("PUBLISH_FAILED"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "PUBLISH_FAILED",
    );
    expect(callsWith("INSERT IGNORE")).toEqual([]);
    expect(callsWith("DELETE FROM bg_planning_events").map(([, params]) => params)).toEqual([[EVENT_ID]]);
  });

  it("setManualAssignment_matchWithoutReferee_noRemovedEvent", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: null })], members }));
    routeSql();

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true });

    expect(callsWith("INSERT INTO bg_planning_events").map(([, params]) => params)).toEqual([
      ["m:1", 3, "REFEREE", 10, 1, "ASSIGNED", "MANUAL", 9],
    ]);
  });

  it("setManualAssignment_designationRefused_displacedRemovalEventErasedToo", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ rows: [assignmentRow()], matchReferee: 7, displaced: [7] });
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("REFEREE_CHANGED"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "REFEREE_CHANGED",
    );
    expect(callsWith("DELETE FROM bg_planning_events")[0][1]).toEqual([EVENT_ID, EVENT_ID + 1]);
  });

  it("setManualAssignment_designationRefused_planningRowsAndEventUndone", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ rows: [assignmentRow()], matchReferee: 7 });
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("REFEREE_CHANGED"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "REFEREE_CHANGED",
    );
    expect(callsWith("WHERE entry_key = ? AND user_id = ? AND role = ?").slice(-2).map(([, params]) => params)).toEqual([
      ["m:1", 3, "REFEREE"],
      ["m:1", 7, "REFEREE"],
    ]);
    expect(callsWith("INSERT IGNORE INTO bg_planning_assignments")[0][1]).toEqual([
      "m:1", "REFEREE", 10, 1, "MANUAL", "MANUAL", 1, 9, CREATED_AT, 7,
    ]);
    // L'évènement de retrait de l'arbitre que portait le match, puis celui de la pose.
    expect(callsWith("DELETE FROM bg_planning_events")[0][1]).toEqual([EVENT_ID, EVENT_ID + 1]);
    expect(callsWith("UPDATE bg_matches")).toEqual([]);
  });

  it("setManualAssignment_panneButMatchHasNewReferee_planningKept", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ rows: [assignmentRow()], matchReferee: [7, 3] });
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("PUBLISH_FAILED"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "PUBLISH_FAILED",
    );
    expect(callsWith("INSERT IGNORE")).toEqual([]);
    expect(callsWith("DELETE FROM bg_planning_events")).toEqual([]);
  });

  it("setManualAssignment_panneMatchUnchanged_planningUndone", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ rows: [assignmentRow()], matchReferee: 7 });
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "ER_LOCK_DEADLOCK",
    );
    expect(callsWith("INSERT IGNORE")).toHaveLength(1);
  });

  it("setManualAssignment_matchRefereeUnavailable_neutralRefusalAndUndone", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ rows: [assignmentRow()], matchReferee: 7 });
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("REFEREE_UNAVAILABLE"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "PLANNING_ROLE_NOT_HELD",
    );
    expect(callsWith("INSERT IGNORE")).toHaveLength(1);
  });

  it("setManualAssignment_matchReferee_onePlanningReReadOnly", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ matchReferee: 7 });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true });

    expect(loadPlanningMembersByIds).toHaveBeenCalledTimes(1);
  });

  it("setManualAssignment_matchAlreadyHasWanted_noDesignationCall", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    routeSql({ rows: [assignmentRow()], matchReferee: 3 });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true });

    expect(assignMatchReferee).not.toHaveBeenCalled();
    expect(callsWith("INSERT INTO bg_planning_assignments")[0][1]).toEqual(["m:1", 3, "REFEREE", 10, 1, "MANUAL", "MANUAL", 1, 9]);
  });

  it("setManualAssignment_tournamentCaster_noSnapshotRead", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [event], members }));

    await setManualAssignment(staff, { entryKey: "t:10", role: "CASTER", userId: 4, assigned: true });

    expect(callsWith("SELECT entry_key")).toEqual([]);
  });

  it("setManualAssignment_designationRefused_onlyTouchedKeysRestored", async () => {
    const other = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + HOUR_MS / 2, endAt: MONDAY + 2 * HOUR_MS });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry({ matchRefereeId: 7 }), other],
        members,
        assignments: [loadedAssignment({ entryKey: "m:2", userId: 3, role: "REFEREE" })],
      }),
    );
    const caster = assignmentRow({ user_id: 4, role: "CASTER" });
    const released = assignmentRow({ entry_key: "m:2", match_id: 2, user_id: 3, source: "AUTO", reason: "LOAD", confirmed: 0 });
    routeSql({ rows: [assignmentRow(), caster, released], matchReferee: 7 });
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("REFEREE_CHANGED"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "REFEREE_CHANGED",
    );
    const restored = callsWith("INSERT IGNORE INTO bg_planning_assignments").map(([, params]) => (params as unknown[]).slice(0, 2));
    expect(restored).toEqual([
      ["m:1", "REFEREE"],
      ["m:2", "REFEREE"],
    ]);
    expect(callsWith("INSERT IGNORE").some(([, params]) => (params as unknown[]).includes("CASTER"))).toBe(false);
  });

  it("setManualAssignment_planningBlockFails_matchNeverTouched", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 7 })], members }));
    execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT")) return [[], []];
      if (sql.includes("INSERT INTO bg_planning_assignments")) throw new Error("ER_LOCK_DEADLOCK");
      return [{ affectedRows: 1, insertId: EVENT_ID }];
    });

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: true })).rejects.toThrow(
      "ER_LOCK_DEADLOCK",
    );
    expect(connection.rollback).toHaveBeenCalled();
    expect(assignMatchReferee).not.toHaveBeenCalled();
  });

  it("setManualAssignment_prodOfOtherOnMatch_throwsProdTaken", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchProdId: 4 })], members }));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "PROD", userId: 6, assigned: true })).rejects.toThrow(
      "PLANNING_PROD_TAKEN",
    );
    expect(callsWith("INSERT INTO bg_planning_assignments")).toHaveLength(0);
  });

  it("setManualAssignment_matchProdPosedAsProdByHand_throwsCastManaged", async () => {
    // La prod du match est déjà sa ligne PROD tenue : une ligne à la main la doublerait.
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchProdId: 4 })], members }));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "PROD", userId: 4, assigned: true })).rejects.toThrow(
      "PLANNING_CAST_MANAGED",
    );
    expect(callsWith("INSERT INTO bg_planning_assignments")).toHaveLength(0);
  });

  it("setManualAssignment_matchProdPosedAsCaster_refusedBeforeLock", async () => {
    // La prod du match est une ligne PROD tenue : le conflit de rôles refuse, sans relecture verrouillée.
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchProdId: 4 })], members }));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true })).rejects.toThrow(
      "PLANNING_ROLE_CONFLICT",
    );
    expect(callsWith("SELECT id, prod_user_id FROM bg_matches")).toHaveLength(0);
  });

  it("setManualAssignment_prodPlacedDuringGesture_throwsProdTaken", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()], members }));
    routeSql({ matchProd: 4 });

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "PROD", userId: 6, assigned: true })).rejects.toThrow(
      "PLANNING_PROD_TAKEN",
    );
    expect(callsWith("SELECT id, prod_user_id FROM bg_matches")[0]?.[0]).toContain("LOCK IN SHARE MODE");
    expect(callsWith("INSERT INTO bg_planning_assignments")).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("setManualAssignment_casterWhoBecameMatchProd_throwsRoleConflict", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()], members }));
    routeSql({ matchProd: 4 });

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "CASTER", userId: 4, assigned: true })).rejects.toThrow(
      "PLANNING_ROLE_CONFLICT",
    );
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
    expect(callsWith("SELECT entry_key")).toEqual([]);
    expect(callsWith("INSERT INTO bg_planning_events")[0][1]).toEqual(["m:1", 3, "REFEREE", 10, 1, "REMOVED", "MANUAL", 9]);
  });

  it("unassign_confirmedMatchReferee_releasesOnMatch", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 3 })] }));
    routeSql({ matchReferee: 3 });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: false });

    expect(assignMatchReferee).toHaveBeenCalledWith(1, 9, null, 3);
  });

  it("unassign_matchAlreadyWithoutReferee_noDesignationCall", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 3 })] }));
    routeSql({ matchReferee: null });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: false });

    expect(assignMatchReferee).not.toHaveBeenCalled();
    expect(callsWith("INSERT INTO bg_planning_events")[0][1]).toEqual(["m:1", 3, "REFEREE", 10, 1, "REMOVED", "MANUAL", 9]);
  });

  it("unassign_matchCarriesAnotherReferee_noDesignationCall", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 3 })] }));
    routeSql({ matchReferee: 8 });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: false });

    expect(assignMatchReferee).not.toHaveBeenCalled();
    expect(callsWith("INSERT INTO bg_planning_events")[0][1]).toEqual(["m:1", 3, "REFEREE", 10, 1, "REMOVED", "MANUAL", 9]);
  });

  it("unassign_matchReadFails_stillReleasesOnMatch", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 3 })] }));
    routeSql({ readFails: true });

    await setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: false });

    expect(assignMatchReferee).toHaveBeenCalledWith(1, 9, null, 3);
  });

  it("unassign_designationRefused_rowRestoredRemovalEventErased", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 3 })] }));
    routeSql({ rows: [assignmentRow({ user_id: 3 })], matchReferee: 3 });
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("REFEREE_CHANGED"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: false })).rejects.toThrow(
      "REFEREE_CHANGED",
    );
    expect(callsWith("INSERT IGNORE INTO bg_planning_assignments")[0][1]).toEqual(expect.arrayContaining(["m:1", 3, "REFEREE"]));
    expect(callsWith("DELETE FROM bg_planning_events")[0][1]).toEqual([EVENT_ID]);
  });

  it("unassign_panneAfterRelease_matchWithoutReferee_planningKept", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry({ matchRefereeId: 3 })] }));
    routeSql({ rows: [assignmentRow({ user_id: 3 })], matchReferee: [3, null] });
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("PUBLISH_FAILED"));

    await expect(setManualAssignment(staff, { entryKey: "m:1", role: "REFEREE", userId: 3, assigned: false })).rejects.toThrow(
      "PUBLISH_FAILED",
    );
    expect(callsWith("INSERT IGNORE")).toEqual([]);
  });
});

describe("PLANNING_STATUSES", () => {
  it("PLANNING_STATUSES_everyMatchRefereeRefusal_mapped", () => {
    for (const code of MATCH_REFEREE_REFUSAL_CODES) expect(PLANNING_STATUSES[code]).toBeDefined();
    expect(PLANNING_STATUSES.MATCH_NOT_FOUND).toBe(404);
    expect(PLANNING_STATUSES.REFEREE_DISCORD_REQUIRED).toBe(409);
    expect(PLANNING_STATUSES.PLANNING_OVERLAP_MANAGED).toBe(409);
    expect(PLANNING_STATUSES.PLANNING_CASTERS_FULL).toBe(409);
  });
});
