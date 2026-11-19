import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import { exportOwnPlanning } from "@/lib/server/users/planning-export";
import { connectionMock, fakePool } from "../../../helpers/sql-double";

/** Export (art. 15 et 20) de ce que le planning garde du titulaire, historique compris (`CAST_PLANNING.md`). */

const pool = connectionMock();
const { execute } = pool;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getDatabase).mockResolvedValue(fakePool(pool));
});

function routeSql(
  tables: { events?: unknown[]; assignments?: unknown[]; acted?: unknown[]; set?: unknown[]; missing?: boolean } = {},
) {
  execute.mockImplementation(async (sql: string) => {
    if (tables.missing) throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" });
    if (sql.includes("WHERE actor_user_id = ?")) return [tables.acted ?? [], []];
    if (sql.includes("WHERE assigned_by_user_id = ?")) return [tables.set ?? [], []];
    if (sql.includes("FROM bg_planning_assignments")) return [tables.assignments ?? [], []];
    if (sql.includes("FROM bg_planning_events")) return [tables.events ?? [], []];
    return [[], []];
  });
}

describe("exportOwnPlanning", () => {
  it("exportOwnPlanning_withdrawal_carriesReasonAndLateness", async () => {
    routeSql({
      events: [
        { tournament_id: 10, match_id: 1, role: "CASTER", kind: "WITHDRAWN", source: "MANUAL", reason: "Malade", late: 1, created_at: new Date("2026-11-20T18:00:00.000Z") },
      ],
    });

    const data = await exportOwnPlanning(4);

    expect(data.history).toEqual([
      { tournamentId: 10, matchId: 1, role: "CASTER", kind: "WITHDRAWN", source: "MANUAL", createdAt: "2026-11-20T18:00:00.000Z", reason: "Malade", late: true },
    ]);
  });

  it("exportOwnPlanning_staffReleasedWithdrawal_flagged", async () => {
    routeSql({
      events: [
        { tournament_id: 10, match_id: 1, role: "CASTER", kind: "WITHDRAWN", source: "MANUAL", reason: null, late: 0, staff_release: 1, created_at: new Date("2026-11-20T18:00:00.000Z") },
      ],
    });

    const data = await exportOwnPlanning(4);

    expect(data.history[0]).toEqual({
      tournamentId: 10,
      matchId: 1,
      role: "CASTER",
      kind: "WITHDRAWN",
      source: "MANUAL",
      createdAt: "2026-11-20T18:00:00.000Z",
      reason: null,
      late: false,
      staffRelease: true,
    });
  });

  it("exportOwnPlanning_events_historyOfTheHolderWithoutActor", async () => {
    routeSql({
      events: [
        { tournament_id: 10, match_id: 1, role: "CASTER", kind: "REMOVED", source: "MANUAL", created_at: new Date("2026-11-20T18:00:00.000Z"), actor_user_id: 9 },
      ],
    });

    const data = await exportOwnPlanning(4);

    expect(data.history).toEqual([
      { tournamentId: 10, matchId: 1, role: "CASTER", kind: "REMOVED", source: "MANUAL", createdAt: "2026-11-20T18:00:00.000Z" },
    ]);
  });

  it("exportOwnPlanning_eventsQuery_onlyTheHolderAndNoActorColumn", async () => {
    routeSql();

    await exportOwnPlanning(4);

    const [sql, params] = execute.mock.calls.find(([text]) => text.includes("FROM bg_planning_events WHERE user_id")) ?? [];
    expect(sql).toContain("WHERE user_id = ?");
    expect(sql).not.toContain("actor_user_id");
    expect(params).toEqual([4]);
  });

  it("exportOwnPlanning_assignments_includeReason", async () => {
    routeSql({
      assignments: [
        { entry_key: "m:1", tournament_id: 10, match_id: 1, role: "CASTER", source: "AUTO", reason: "PREFERENCE", confirmed: 0, created_at: new Date("2026-11-20T18:00:00.000Z") },
      ],
    });

    const data = await exportOwnPlanning(4);

    expect(data.assignments).toEqual([
      { tournamentId: 10, matchId: 1, role: "CASTER", source: "AUTO", reason: "PREFERENCE", confirmed: false, createdAt: "2026-11-20T18:00:00.000Z" },
    ]);
  });

  it("exportOwnPlanning_tablesMissing_emptyLists", async () => {
    routeSql({ missing: true });

    expect(await exportOwnPlanning(4)).toEqual({
      availability: [],
      assignments: [],
      history: [],
      staffActions: [],
      assignmentsSet: [],
      soloCaster: null,
    });
  });

  it("exportOwnPlanning_actorEvents_exportedAsStaffActionsWithoutSubject", async () => {
    routeSql({
      acted: [
        { tournament_id: 10, match_id: 1, role: "REFEREE", kind: "CONFIRMED", source: "AUTO", created_at: new Date("2026-11-20T18:00:00.000Z") },
      ],
    });

    const data = await exportOwnPlanning(4);

    expect(data.staffActions).toEqual([
      { tournamentId: 10, matchId: 1, role: "REFEREE", kind: "CONFIRMED", source: "AUTO", createdAt: "2026-11-20T18:00:00.000Z" },
    ]);
  });

  it("exportOwnPlanning_staffActionsStaffRelease_marked", async () => {
    routeSql({
      acted: [
        { tournament_id: 10, match_id: 1, role: "CASTER", kind: "WITHDRAWN", source: "MANUAL", staff_release: 1, created_at: new Date("2026-11-20T18:00:00.000Z") },
      ],
    });

    const data = await exportOwnPlanning(4);

    expect(data.staffActions).toEqual([
      { tournamentId: 10, matchId: 1, role: "CASTER", kind: "WITHDRAWN", source: "MANUAL", createdAt: "2026-11-20T18:00:00.000Z", staffRelease: true },
    ]);
  });

  it("exportOwnPlanning_assignmentsSet_mappedWithoutReasonOrSubject", async () => {
    routeSql({
      set: [
        { tournament_id: 10, match_id: null, role: "CASTER", source: "MANUAL", confirmed: 1, created_at: new Date("2026-11-20T18:00:00.000Z") },
      ],
    });

    const data = await exportOwnPlanning(4);

    expect(data.assignmentsSet).toEqual([
      { tournamentId: 10, matchId: null, role: "CASTER", source: "MANUAL", confirmed: true, createdAt: "2026-11-20T18:00:00.000Z" },
    ]);
  });

  it("exportOwnPlanning_staffQueries_keyedOnTheHolderAsActorWithoutSubject", async () => {
    routeSql();

    await exportOwnPlanning(4);

    const acted = execute.mock.calls.find(([text]) => text.includes("WHERE actor_user_id = ?"));
    const set = execute.mock.calls.find(([text]) => text.includes("WHERE assigned_by_user_id = ?"));
    expect(acted?.[1]).toEqual([4]);
    expect(set?.[1]).toEqual([4]);
    expect(acted?.[0].split("FROM")[0]).not.toContain("user_id");
    expect(set?.[0].split("FROM")[0]).not.toContain("user_id");
  });

  it("exportOwnPlanning_queries_neverSelectEntryKey", async () => {
    routeSql();

    await exportOwnPlanning(4);

    for (const [sql] of execute.mock.calls) expect(sql.split("FROM")[0]).not.toContain("entry_key");
  });

  it("exportOwnPlanning_staffRowsWithStrayIdentifiers_neverCarryThem", async () => {
    routeSql({
      acted: [
        { tournament_id: 10, match_id: 1, role: "REFEREE", kind: "REMOVED", source: "MANUAL", created_at: new Date("2026-11-20T18:00:00.000Z"), user_id: 7, actor_user_id: 4 },
      ],
      set: [
        { tournament_id: 10, match_id: 1, role: "CASTER", source: "MANUAL", confirmed: 0, created_at: new Date("2026-11-20T18:00:00.000Z"), user_id: 7, assigned_by_user_id: 4 },
      ],
    });

    const data = await exportOwnPlanning(4);

    expect(data.staffActions).toEqual([
      { tournamentId: 10, matchId: 1, role: "REFEREE", kind: "REMOVED", source: "MANUAL", createdAt: "2026-11-20T18:00:00.000Z" },
    ]);
    expect(data.assignmentsSet).toEqual([
      { tournamentId: 10, matchId: 1, role: "CASTER", source: "MANUAL", confirmed: false, createdAt: "2026-11-20T18:00:00.000Z" },
    ]);
  });

  it("exportOwnPlanning_otherFailure_propagates", async () => {
    execute.mockRejectedValue(new Error("ER_LOCK_DEADLOCK"));

    await expect(exportOwnPlanning(4)).rejects.toThrow("ER_LOCK_DEADLOCK");
  });
});
