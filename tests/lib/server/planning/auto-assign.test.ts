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
  loadPlanningMembersByIds: jest.fn(),
  loadHiddenTournamentIds: jest.fn(),
}));
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/planning/players", () => ({
  ...jest.requireActual<typeof import("@/lib/server/planning/players")>("@/lib/server/planning/players"),
  loadEntryPlayers: jest.fn(),
}));
jest.mock("@/lib/server/tournaments/cast-eligibility");

import type { PoolConnection } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import {
  batchEntries,
  confirmAssignments,
  entriesToConfirm,
  excludeFromHidden,
  holdingRefusal,
  lockedHolding,
  preparePlanner,
  runAutoAssign,
  withPlanningLock,
  writeEvent,
} from "@/lib/server/planning/auto-assign";
import { loadHiddenTournamentIds, loadPlanningData, loadPlanningHistory, loadPlanningMembersByIds } from "@/lib/server/planning/load";
import { loadEntryPlayers } from "@/lib/server/planning/players";
import { loadEligibleRefereeIds } from "@/lib/server/tournaments/cast-eligibility";
import { assignMatchReferee } from "@/lib/server/tournaments/match-launch";

import { available, HOUR_MS, loadedAssignment, loadedEntry, loadedMember, MONDAY, planningData } from "../../../helpers/planning";
import { connectionMock, fakeConnection, fakePool } from "../../../helpers/sql-double";

/**
 * Calcul par lot et confirmation (`CAST_PLANNING.md` § Calcul, § Provisoire,
 * confirmé, manuel) : base simulée, verrou toujours obtenu.
 */

const connection = connectionMock();
const { execute } = connection;

/**
 * Base simulée : réconciliation des arbitres de match (`confirmPendingReferees`,
 * ses instructions joignent `bg_matches m ON m.id = a.match_id` ; `healed` =
 * propositions confirmées), lignes touchées, requête en panne, évènement sans identifiant.
 */
type SqlRoute = { healed?: number; affected?: number; deleted?: number; failOn?: string; noInsertId?: boolean; proposalGone?: boolean };

const RECONCILE = "JOIN bg_matches m ON m.id = a.match_id";
/** La relecture, sous le verrou, d'une proposition d'arbitre de match avant sa désignation. */
const RECHECK = "SELECT 1 FROM bg_planning_assignments";

function routeSql(route: SqlRoute = {}) {
  execute.mockImplementation(async (sql: string) => {
    if (route.failOn !== undefined && sql.includes(route.failOn)) throw new Error("ER_LOCK_DEADLOCK");
    if (sql.includes(RECONCILE)) return [{ affectedRows: route.healed ?? 0 }];
    if (sql.includes(RECHECK)) return [route.proposalGone ? [] : [{ 1: 1 }]];
    if (sql.includes("INSERT INTO bg_planning_events")) return [route.noInsertId ? { affectedRows: 1 } : { affectedRows: 1, insertId: 1 }];
    if (sql.startsWith("DELETE") && route.deleted !== undefined) return [{ affectedRows: route.deleted }];
    return [{ affectedRows: route.affected ?? 1 }];
  });
}

/** Paramètres des écritures jouées (la réconciliation exclue). */
function writeParams(): unknown[] {
  return execute.mock.calls.filter(([sql]) => !sql.includes(RECONCILE) && !sql.includes(RECHECK)).map(([, params]) => params);
}

/** Les instructions de la réconciliation, réduites à leur début. */
function reconcileStatements(): string[] {
  return execute.mock.calls.filter(([sql]) => sql.includes(RECONCILE)).map(([sql]) => sql.replace(/\s+/g, " ").trim().slice(0, 40));
}

beforeEach(() => {
  jest.clearAllMocks();
  routeSql();
  connection.beginTransaction.mockResolvedValue(undefined);
  connection.commit.mockResolvedValue(undefined);
  connection.rollback.mockResolvedValue(undefined);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({}));
  jest.mocked(withConnection).mockImplementation(<T>(run: (c: PoolConnection) => Promise<T>) => run(fakeConnection(connection)));
  jest.mocked(withNamedLock).mockImplementation(<T>(_pool: unknown, _name: string, _seconds: number, run: (c: PoolConnection) => Promise<T>) =>
    run(fakeConnection(connection)),
  );
  jest.mocked(loadPlanningHistory).mockResolvedValue(new Map());
  jest.mocked(loadEntryPlayers).mockResolvedValue(new Map());
  jest.mocked(loadEligibleRefereeIds).mockImplementation(async (_executor, ids) => new Set(ids));
  jest.mocked(assignMatchReferee).mockResolvedValue(undefined);
  // Relecture verrouillée dans la transaction : par défaut, chacun tient tous les rôles et voit tout.
  jest.mocked(loadPlanningMembersByIds).mockImplementation(async (_executor, ids) =>
    ids.map((userId) => loadedMember({ userId, roles: ["REFEREE", "CASTER", "PROD"], seesHidden: true })),
  );
  jest.mocked(loadHiddenTournamentIds).mockResolvedValue(new Set());
});

/** Requêtes jouées, réduites à leur début (le verbe et la table). */
function statements(): string[] {
  return execute.mock.calls
    .filter(([sql]) => !sql.includes(RECONCILE) && !sql.includes(RECHECK))
    .map(([sql]) => sql.replace(/\s+/g, " ").trim().slice(0, 40));
}

describe("writeEvent", () => {
  it("writeEvent_noInsertId_throws", async () => {
    routeSql({ noInsertId: true });

    await expect(writeEvent(fakeConnection(connection), loadedEntry(), 3, "CASTER", "ASSIGNED", "MANUAL", 9)).rejects.toThrow(
      "PLANNING_EVENT_ID_MISSING",
    );
  });

  it("writeEvent_insertId_returnsIt", async () => {
    routeSql();

    await expect(writeEvent(fakeConnection(connection), loadedEntry(), 3, "CASTER", "ASSIGNED", "MANUAL", 9)).resolves.toBe(1);
  });
});

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

    expect(input.locked).toEqual([{ entryKey: "m:2", userId: 2, role: "CASTER", reason: "LOAD", provisional: true }]);
    expect(input.entries.map((entry) => [entry.key, entry.open])).toEqual([
      ["m:1", true],
      ["m:2", false],
    ]);
  });

  it("preparePlanner_inBatchProvisionalCasterWithSignup_lockedAsCast", () => {
    const data = planningData({
      entries: [inside],
      assignments: [loadedAssignment({ entryKey: "m:1", userId: 4, role: "CASTER" })],
      matchCasters: new Map([["m:1", [4]]]),
    });

    const input = preparePlanner(data, [inside], new Map(), new Set());

    expect(input.locked).toEqual([{ entryKey: "m:1", userId: 4, role: "CASTER", reason: "CAST" }]);
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

  it("preparePlanner_historyWeek_passedToPlanner", () => {
    expect(preparePlanner(planningData({ entries: [inside] }), [inside], new Map(), new Set(), MONDAY).historyWeek).toBe(MONDAY);
  });
});

describe("excludeFromHidden", () => {
  const hidden = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null, hidden: true });

  it("excludeFromHidden_casterAndProdOnHiddenEntry_excludedInEveryRole", () => {
    const excluded = new Set<string>();

    excludeFromHidden({ members: [loadedMember({ userId: 4, roles: ["CASTER", "PROD"] })] }, [hidden], excluded);

    expect([...excluded]).toEqual(["t:10|4|CASTER", "t:10|4|PROD"]);
  });

  it("excludeFromHidden_tournamentStaff_notExcluded", () => {
    const excluded = new Set<string>();

    excludeFromHidden({ members: [loadedMember({ userId: 3, roles: ["REFEREE", "CASTER"] })] }, [hidden], excluded);

    expect(excluded.size).toBe(0);
  });

  it("excludeFromHidden_refereeRoleWithoutSeesHidden_excluded", () => {
    const excluded = new Set<string>();

    excludeFromHidden({ members: [loadedMember({ userId: 3, roles: ["REFEREE"], seesHidden: false })] }, [hidden], excluded);

    expect([...excluded]).toEqual(["t:10|3|REFEREE"]);
  });

  it("excludeFromHidden_visibleEntry_nothingExcluded", () => {
    const excluded = new Set<string>();

    excludeFromHidden({ members: [loadedMember({ userId: 4, roles: ["CASTER"] })] }, [loadedEntry()], excluded);

    expect(excluded.size).toBe(0);
  });
});

describe("holdingRefusal", () => {
  const hidden = loadedEntry({ hidden: true });

  it("holdingRefusal_memberGone_roleNotHeld", () => {
    expect(holdingRefusal(undefined, loadedEntry(), "CASTER")).toBe("PLANNING_ROLE_NOT_HELD");
  });

  it("holdingRefusal_roleLost_roleNotHeld", () => {
    expect(holdingRefusal(loadedMember({ roles: ["PROD"] }), loadedEntry(), "CASTER")).toBe("PLANNING_ROLE_NOT_HELD");
  });

  it("holdingRefusal_hiddenEntryWithoutSeesHidden_hiddenForMember", () => {
    expect(holdingRefusal(loadedMember({ roles: ["CASTER"], seesHidden: false }), hidden, "CASTER")).toBe("PLANNING_HIDDEN_FOR_MEMBER");
  });

  it("holdingRefusal_hiddenEntrySeesHidden_null", () => {
    expect(holdingRefusal(loadedMember({ roles: ["CASTER"], seesHidden: true }), hidden, "CASTER")).toBeNull();
  });

  it("holdingRefusal_visibleEntry_null", () => {
    expect(holdingRefusal(loadedMember({ roles: ["CASTER"], seesHidden: false }), loadedEntry(), "CASTER")).toBeNull();
  });
});

describe("lockedHolding", () => {
  it("lockedHolding_noRows_noRead", async () => {
    await lockedHolding(fakeConnection(connection), []);

    expect(loadPlanningMembersByIds).not.toHaveBeenCalled();
    expect(loadHiddenTournamentIds).not.toHaveBeenCalled();
  });

  it("lockedHolding_rows_readsAccountsUnderLock", async () => {
    await lockedHolding(fakeConnection(connection), [{ userId: 4, entry: loadedEntry() }]);

    expect(jest.mocked(loadPlanningMembersByIds).mock.calls[0].slice(1)).toEqual([[4], { lock: true }]);
    expect(jest.mocked(loadHiddenTournamentIds).mock.calls[0][1]).toEqual([10]);
  });

  it("lockedHolding_tournamentRehidden_refusedDespiteStaleEntry", async () => {
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"], seesHidden: false })]);
    jest.mocked(loadHiddenTournamentIds).mockResolvedValue(new Set([10]));
    const stale = loadedEntry({ hidden: false });

    const holds = await lockedHolding(fakeConnection(connection), [{ userId: 4, entry: stale }]);

    expect(holds(4, stale, "CASTER")).toBe("PLANNING_HIDDEN_FOR_MEMBER");
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
    expect(statements()).toEqual([]);
  });

  it("runAutoAssign_emptyBatchWithPendingReferee_healedInTransaction", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry()] }));
    routeSql({ healed: 1 });

    await runAutoAssign(9, { from: MONDAY + 100 * HOUR_MS, to: MONDAY + 120 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(reconcileStatements()).toEqual([
      "DELETE a FROM bg_planning_assignments a ",
      "INSERT INTO bg_planning_events (entry_ke",
      "UPDATE bg_planning_assignments a JOIN bg",
    ]);
    expect(statements()).toEqual([]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("runAutoAssign_deletesProvisionalOfBatchThenInsertsAuto", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
      }),
    );
    routeSql({ deleted: 2 });

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report).toEqual({ entries: 1, proposed: 1, replaced: 2 });
    expect(statements()).toEqual([
      "DELETE FROM bg_planning_assignments WHER",
      "INSERT INTO bg_planning_assignments (ent",
      "INSERT INTO bg_planning_events (entry_ke",
    ]);
    expect(writeParams()[1]).toEqual(["m:1", 3, "REFEREE", 10, 1, "LOAD", 9]);
    expect(writeParams()[2]).toEqual(["m:1", 3, "REFEREE", 10, 1, 9]);
  });

  it("runAutoAssign_roleLostUnderLock_proposalNotWritten", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
      }),
    );
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([]);

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report.proposed).toBe(0);
    expect(statements()).toEqual(["DELETE FROM bg_planning_assignments WHER"]);
    expect(jest.mocked(loadPlanningMembersByIds).mock.calls[0][2]).toEqual({ lock: true });
  });

  it("runAutoAssign_tournamentRehiddenUnderLock_proposalNotWritten", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 4, "CASTER")],
        members: [loadedMember({ userId: 4, roles: ["CASTER"], seesHidden: false })],
      }),
    );
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([loadedMember({ userId: 4, roles: ["CASTER"], seesHidden: false })]);
    jest.mocked(loadHiddenTournamentIds).mockResolvedValue(new Set([10]));

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report.proposed).toBe(0);
  });

  it("runAutoAssign_rerunUnchangedProposal_writesNoNewEvent", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
        assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE", reason: "LOAD" })],
      }),
    );

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report.proposed).toBe(1);
    expect(statements()).toEqual(["DELETE FROM bg_planning_assignments WHER", "INSERT INTO bg_planning_assignments (ent"]);
  });

  it("runAutoAssign_rerunChangedReason_writesTheEvent", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
        assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE", reason: "PREFERENCE" })],
      }),
    );

    await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(statements()).toContain("INSERT INTO bg_planning_events (entry_ke");
  });

  it("runAutoAssign_manyProposals_writtenInGroupedStatements", async () => {
    const entries = Array.from({ length: 450 }, (_, index) =>
      loadedEntry({ key: `m:${index + 1}`, matchId: index + 1, startAt: MONDAY + index * 2 * HOUR_MS, endAt: MONDAY + (index * 2 + 1) * HOUR_MS }),
    );
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries,
        availability: entries.map((entry) => available(entry.key, 3, "REFEREE")),
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
      }),
    );

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 1000 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report.proposed).toBe(450);
    // 450 lignes : trois instructions de lignes et trois d'évènements, et non 900 allers-retours.
    expect(statements().filter((sql) => sql.startsWith("INSERT INTO bg_planning_assignments"))).toHaveLength(3);
    expect(statements().filter((sql) => sql.startsWith("INSERT INTO bg_planning_events"))).toHaveLength(3);
  });

  it("runAutoAssign_pendingRefereeOnMatch_confirmedBeforeDelete", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry({ matchRefereeId: 3 })],
        assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })],
      }),
    );
    routeSql({ healed: 1 });

    await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    const order = execute.mock.calls.map(([sql]) => (sql.includes(RECONCILE) ? "reconcile" : sql.trim().slice(0, 6)));
    expect(order.slice(0, 4)).toEqual(["reconcile", "reconcile", "reconcile", "DELETE"]);
  });

  it("runAutoAssign_reconcile_sweepsConfirmedRefereeMatchNoLongerHolds", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [] }));

    await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    const sweep = execute.mock.calls.find(([sql]) => sql.startsWith("DELETE a FROM"))?.[0];
    expect(sweep).toContain("a.confirmed = 1");
    expect(sweep).toContain("m.referee_user_id IS NULL OR m.referee_user_id <> a.user_id");
  });

  it("runAutoAssign_entryOutsideBatchNotOverlapping_playersNotLoaded", async () => {
    const far = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + 50 * HOUR_MS, endAt: MONDAY + 51 * HOUR_MS });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [loadedEntry(), far] }));

    await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(jest.mocked(loadEntryPlayers).mock.calls[0][1].map((entry) => entry.key)).toEqual(["m:1"]);
  });

  it("runAutoAssign_matchPlayer_excluded", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
      }),
    );
    jest.mocked(loadEntryPlayers).mockResolvedValue(new Map([["m:1", new Set([3])]]));

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report.proposed).toBe(0);
  });

  it("runAutoAssign_tournamentEntryPlayer_excluded", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null, team1: null, team2: null });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [event],
        availability: [available("t:10", 3, "CASTER")],
        members: [loadedMember({ userId: 3, roles: ["CASTER"], soloCaster: true })],
      }),
    );
    jest.mocked(loadEntryPlayers).mockResolvedValue(new Map([["t:10", new Set([3])]]));

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(report.proposed).toBe(0);
  });

  it("runAutoAssign_playerOfOverlappingMatch_excluded", async () => {
    const other = loadedEntry({ key: "m:2", matchId: 2, startAt: MONDAY + HOUR_MS / 2, endAt: MONDAY + 2 * HOUR_MS });
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry(), other],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
      }),
    );
    jest.mocked(loadEntryPlayers).mockResolvedValue(new Map([["m:2", new Set([3])]]));
    routeSql({ deleted: 0 });

    const report = await runAutoAssign(9, { from: MONDAY, to: MONDAY + HOUR_MS / 4 }, MONDAY - HOUR_MS);

    expect(report).toEqual({ entries: 1, proposed: 0, replaced: 0 });
  });

  it("runAutoAssign_writes_insideOneTransaction", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
      }),
    );

    await runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(connection.beginTransaction.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]);
    expect(connection.commit.mock.invocationCallOrder[0]).toBeGreaterThan(execute.mock.invocationCallOrder[2]);
  });

  it("runAutoAssign_insertFails_rollbackAndThrows", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [loadedEntry()],
        availability: [available("m:1", 3, "REFEREE")],
        members: [loadedMember({ userId: 3, roles: ["REFEREE"] })],
      }),
    );
    routeSql({ failOn: "INSERT INTO bg_planning_assignments" });

    await expect(runAutoAssign(9, { from: MONDAY, to: MONDAY + 24 * HOUR_MS }, MONDAY - HOUR_MS)).rejects.toThrow(
      "ER_LOCK_DEADLOCK",
    );
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("runAutoAssign_futureWindow_historyAnchoredOnWindow", async () => {
    const later = loadedEntry({ startAt: MONDAY + 14 * 24 * HOUR_MS, endAt: MONDAY + 14 * 24 * HOUR_MS + HOUR_MS });
    jest.mocked(loadPlanningData).mockResolvedValue(planningData({ entries: [later] }));
    const from = MONDAY + 14 * 24 * HOUR_MS;

    await runAutoAssign(9, { from, to: from + 24 * HOUR_MS }, MONDAY - HOUR_MS);

    expect(jest.mocked(loadPlanningHistory).mock.calls[0][1]).toBe(from);
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
  const members = [
    loadedMember({ userId: 3, roles: ["REFEREE"] }),
    loadedMember({ userId: 4, roles: ["CASTER"] }),
    loadedMember({ userId: 5, roles: ["REFEREE", "CASTER"] }),
    loadedMember({ userId: 6, roles: ["PROD"] }),
  ];
  /** Les données relues au geste, membres (rôles du moment) compris. */
  const confirmData = (overrides: Parameters<typeof planningData>[0] = {}) => planningData({ members, ...overrides });

  beforeEach(() => {
    // Relecture sous le verrou final : par défaut, les mêmes comptes qu'au début du geste.
    jest.mocked(loadPlanningMembersByIds).mockImplementation(async (_executor, ids) => members.filter((member) => ids.includes(member.userId)));
  });

  it("confirmAssignments_roleLostDuringDesignations_removedNotConfirmed", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 4, role: "CASTER" })] }),
    );
    jest.mocked(loadPlanningMembersByIds).mockResolvedValue([]);

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 1 });
    expect(jest.mocked(loadPlanningMembersByIds).mock.calls[0][1]).toEqual([4]);
    expect(statements()).toEqual(["DELETE FROM bg_planning_assignments WHER", "INSERT INTO bg_planning_events (entry_ke"]);
    expect(writeParams()[1]).toContain("REMOVED");
  });

  it("confirmAssignments_hiddenEntryCasterWithoutTournaments_refused", async () => {
    const hidden = loadedEntry({ key: "m:1", matchId: 1, hidden: true });
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [hidden], assignments: [loadedAssignment({ entryKey: "m:1", userId: 4, role: "CASTER" })] }),
    );

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 1 });
    expect(writeParams()[1]).toContain("REMOVED");
  });

  it("confirmAssignments_tournamentRehiddenUnderLock_refused", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 4, role: "CASTER" })] }),
    );
    jest.mocked(loadHiddenTournamentIds).mockResolvedValue(new Set([10]));

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 1 });
    expect(jest.mocked(loadPlanningMembersByIds).mock.calls[0][2]).toEqual({ lock: true });
  });

  it("confirmAssignments_hiddenEntryMemberSeeingHidden_confirmed", async () => {
    const hidden = loadedEntry({ key: "m:1", matchId: 1, hidden: true });
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [hidden], assignments: [loadedAssignment({ entryKey: "m:1", userId: 5, role: "CASTER" })] }),
    );

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 1, refused: 0 });
  });

  it("confirmAssignments_matchRefereeOnly_notReReadByIds", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );

    await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(loadPlanningMembersByIds).not.toHaveBeenCalled();
  });

  it("confirmAssignments_subset_confirmsOnlyNamedProvisional", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({
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
    expect(writeParams()).toEqual([
      ["m:1", 4, "CASTER"],
      ["m:1", 4, "CASTER", 10, 1, "CONFIRMED", "AUTO", 9],
    ]);
    expect(assignMatchReferee).not.toHaveBeenCalled();
  });

  it("confirmAssignments_alreadyConfirmedByEarlierRun_noEventNotCounted", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 4, role: "CASTER" })] }),
    );
    routeSql({ affected: 0 });

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 0 });
    expect(statements()).toEqual(["UPDATE bg_planning_assignments SET confi"]);
  });

  it("confirmAssignments_matchReferee_appliedViaAssignMatchReferee", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );

    const report = await confirmAssignments(9, { until: MONDAY + HOUR_MS }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 1, refused: 0 });
    expect(assignMatchReferee).toHaveBeenCalledWith(1, 9, 3, null);
  });

  it("confirmAssignments_matchReferee_confirmedOnlyIfMatchStillHasHim", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );
    routeSql({ affected: 0 });

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 0 });
    expect(execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE") && !sql.includes(RECONCILE))?.[0]).toContain("EXISTS (SELECT 1 FROM bg_matches");
    expect(writeParams()).toEqual([["m:1", 3, 1, 3]]);
  });

  it("confirmAssignments_refereeRefused_rowDeletedRemovedEventCounted", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );
    jest.mocked(assignMatchReferee).mockRejectedValue(new Error("REFEREE_IS_PLAYER"));

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 1 });
    expect(statements()).toEqual([
      "DELETE FROM bg_planning_assignments WHER",
      "INSERT INTO bg_planning_events (entry_ke",
    ]);
    expect(writeParams()[1]).toContain("REMOVED");
    expect(connection.commit).toHaveBeenCalled();
  });

  it("confirmAssignments_transientRefereeError_propagatesNothingRemoved", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );
    jest.mocked(assignMatchReferee).mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));

    await expect(confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS)).rejects.toThrow("ER_LOCK_WAIT_TIMEOUT");
    expect(statements()).toEqual([]);
  });

  it("confirmAssignments_pendingRefereeAlreadyOnMatch_healedWithoutMatchCall", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({
        entries: [loadedEntry({ matchRefereeId: 3 })],
        assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })],
      }),
    );
    routeSql({ healed: 1 });

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 1, refused: 0 });
    expect(assignMatchReferee).not.toHaveBeenCalled();
    expect(execute.mock.calls.find(([sql]) => sql.includes(RECONCILE) && sql.includes("INSERT INTO bg_planning_events"))?.[1]).toEqual([9]);
  });

  it("confirmAssignments_nothingPendingOnMatch_noneCounted", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(confirmData({ entries: [first] }));

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 0 });
    expect(statements()).toEqual([]);
  });

  it("confirmAssignments_unloadedEntries_stillReconciledInConstantStatements", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(confirmData({ entries: [] }));
    routeSql({ healed: 5 });

    const report = await confirmAssignments(9, { entryKeys: [] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 5, refused: 0 });
    expect(reconcileStatements()).toHaveLength(3);
  });

  it("confirmAssignments_pendingRefereeOnStartedMatch_healed", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({
        entries: [loadedEntry({ matchRefereeId: 3, open: false, editable: false })],
        assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })],
      }),
    );
    routeSql({ healed: 1 });

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 1, refused: 0 });
    expect(reconcileStatements()).toHaveLength(3);
  });

  it("confirmAssignments_transientFailureAfterFirstReferee_partialWrittenThrowsConfirmPartial", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({
        entries: [first, second],
        assignments: [
          loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" }),
          loadedAssignment({ entryKey: "m:2", userId: 5, role: "REFEREE" }),
          loadedAssignment({ entryKey: "m:2", userId: 4, role: "CASTER" }),
        ],
      }),
    );
    jest.mocked(assignMatchReferee).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(confirmAssignments(9, { entryKeys: ["m:1", "m:2"] }, MONDAY - HOUR_MS)).rejects.toThrow("PLANNING_CONFIRM_PARTIAL");
    expect(console.error).toHaveBeenCalled();

    expect(writeParams()).toEqual([
      ["m:1", 3, 1, 3],
      ["m:1", 3, "REFEREE", 10, 1, "CONFIRMED", "AUTO", 9],
      ["m:2", 4, "CASTER"],
      ["m:2", 4, "CASTER", 10, 2, "CONFIRMED", "AUTO", 9],
    ]);
    expect(connection.commit).toHaveBeenCalled();
  });

  it("confirmAssignments_writeFailsAfterDesignationPanne_originalPanneThrown", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({
        entries: [first],
        assignments: [
          loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" }),
          loadedAssignment({ entryKey: "m:1", userId: 4, role: "CASTER" }),
        ],
      }),
    );
    jest.mocked(assignMatchReferee).mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT"));
    routeSql({ failOn: "UPDATE bg_planning_assignments" });
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS)).rejects.toThrow("ER_LOCK_WAIT_TIMEOUT");
    expect(connection.rollback).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("confirmAssignments_tournamentReferee_noMatchCall", async () => {
    const event = loadedEntry({ key: "t:10", kind: "TOURNAMENT", matchId: null });
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [event], assignments: [loadedAssignment({ entryKey: "t:10", userId: 3, role: "REFEREE" })] }),
    );

    const report = await confirmAssignments(9, { entryKeys: ["t:10"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 1, refused: 0 });
    expect(assignMatchReferee).not.toHaveBeenCalled();
  });

  it("confirmAssignments_casterLostRole_rowRemovedNotConfirmed", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({
        entries: [first],
        members: [loadedMember({ userId: 4, roles: ["PROD"] })],
        assignments: [loadedAssignment({ entryKey: "m:1", userId: 4, role: "CASTER" })],
      }),
    );

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 1 });
    expect(writeParams()).toEqual([
      ["m:1", 4, "CASTER"],
      ["m:1", 4, "CASTER", 10, 1, "REMOVED", "AUTO", 9],
    ]);
    expect(statements()[0]).toBe("DELETE FROM bg_planning_assignments WHER");
  });

  it("confirmAssignments_matchRefereeLostRole_notDesignatedRowRemoved", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      planningData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 1 });
    expect(assignMatchReferee).not.toHaveBeenCalled();
  });

  it("confirmAssignments_matchRefereeProposalRemovedMeanwhile_matchNotTouched", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );
    routeSql({ proposalGone: true, affected: 0 });

    const report = await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(report).toEqual({ confirmed: 0, refused: 0 });
    expect(assignMatchReferee).not.toHaveBeenCalled();
  });

  it("confirmAssignments_matchReferee_designatedUnderPlanningLockAfterRecheck", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );

    await confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS);

    expect(withNamedLock).toHaveBeenCalledTimes(2);
    const recheck = execute.mock.calls.find(([sql]) => sql.includes(RECHECK));
    expect(recheck?.[1]).toEqual(["m:1", 3]);
    expect(execute.mock.invocationCallOrder[execute.mock.calls.indexOf(recheck!)]).toBeLessThan(
      jest.mocked(assignMatchReferee).mock.invocationCallOrder[0],
    );
  });

  it("confirmAssignments_designationLockBusy_failureNothingDesignated", async () => {
    jest.mocked(loadPlanningData).mockResolvedValue(
      confirmData({ entries: [first], assignments: [loadedAssignment({ entryKey: "m:1", userId: 3, role: "REFEREE" })] }),
    );
    jest.mocked(withNamedLock).mockRejectedValueOnce(new NamedLockUnavailableError("bg_planning", 10));

    await expect(confirmAssignments(9, { entryKeys: ["m:1"] }, MONDAY - HOUR_MS)).rejects.toThrow("PLANNING_BUSY");
    expect(assignMatchReferee).not.toHaveBeenCalled();
  });
});
