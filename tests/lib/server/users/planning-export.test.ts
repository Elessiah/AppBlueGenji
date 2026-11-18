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

function routeSql(tables: { events?: unknown[]; assignments?: unknown[]; missing?: boolean } = {}) {
  execute.mockImplementation(async (sql: string) => {
    if (tables.missing) throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" });
    if (sql.includes("FROM bg_planning_assignments")) return [tables.assignments ?? [], []];
    if (sql.includes("FROM bg_planning_events")) return [tables.events ?? [], []];
    return [[], []];
  });
}

describe("exportOwnPlanning", () => {
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

    const [sql, params] = execute.mock.calls.find(([text]) => text.includes("FROM bg_planning_events")) ?? [];
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

    expect(await exportOwnPlanning(4)).toEqual({ availability: [], assignments: [], history: [], soloCaster: null });
  });

  it("exportOwnPlanning_otherFailure_propagates", async () => {
    execute.mockRejectedValue(new Error("ER_LOCK_DEADLOCK"));

    await expect(exportOwnPlanning(4)).rejects.toThrow("ER_LOCK_DEADLOCK");
  });
});
