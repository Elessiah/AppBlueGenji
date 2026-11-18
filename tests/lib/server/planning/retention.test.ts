import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { purgeExpiredPlanning } from "@/lib/server/planning/retention";
import { PLANNING_RETENTION_DAYS } from "@/lib/shared/planning";
import { fakeConnection, type SqlQuery } from "../../../helpers/sql-double";

/** Durée de conservation du planning (`CAST_PLANNING.md` § Conservation et RGPD). */

const execute = jest.fn<SqlQuery>();
const NOW = Date.UTC(2026, 10, 23);
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("purgeExpiredPlanning", () => {
  it("purgeExpiredPlanning_cutoffRetentionDays_sumsAffectedRows", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 2 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 3 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const removed = await purgeExpiredPlanning(fakeConnection({ execute }), NOW);

    expect(removed).toBe(7);
    expect(execute.mock.calls[0][1]).toEqual([new Date(NOW - PLANNING_RETENTION_DAYS * DAY_MS)]);
    expect(execute.mock.calls.map(([sql]) => /DELETE p FROM (\w+)/.exec(sql)?.[1])).toEqual([
      "bg_planning_availability",
      "bg_planning_assignments",
      "bg_planning_events",
      "bg_planning_profiles",
    ]);
  });

  it("purgeExpiredPlanning_profiles_removedWhenNoPlanningRoleOrDeleted", async () => {
    execute.mockResolvedValue([{ affectedRows: 0 }]);

    await purgeExpiredPlanning(fakeConnection({ execute }), NOW);

    const profiles = execute.mock.calls[3][0];
    expect(profiles).toContain("u.is_deleted = 1 OR NOT");
    expect(profiles).toContain("JSON_CONTAINS(u.platform_roles_json");
  });
});
