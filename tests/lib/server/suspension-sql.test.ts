import { describe, expect, it, jest } from "@jest/globals";
import { activeSuspensionSql, lockedSuspendedUserIds, userSuspendedSql } from "@/lib/server/suspension-sql";
import { fakeConnection, type SqlQuery } from "@/tests/helpers/sql-double";

describe("userSuspendedSql", () => {
  it("userSuspendedSql_column_existsOnThatColumnWithActiveCondition", () => {
    expect(userSuspendedSql("u.id")).toBe(
      `EXISTS (SELECT 1 FROM bg_account_suspensions sus WHERE sus.user_id = u.id AND ${activeSuspensionSql("sus")})`,
    );
  });
});

describe("lockedSuspendedUserIds", () => {
  it("lockedSuspendedUserIds_emptyIds_returnsEmptySetWithoutQuery", async () => {
    const execute = jest.fn<SqlQuery>();

    const actual = await lockedSuspendedUserIds(fakeConnection({ execute }), []);

    expect(actual).toEqual(new Set());
    expect(execute).not.toHaveBeenCalled();
  });

  it("lockedSuspendedUserIds_someSuspended_returnsTheirIdsWithLockingRead", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[{ user_id: "3" }], []]);

    const actual = await lockedSuspendedUserIds(fakeConnection({ execute }), [3, 4]);

    expect(actual).toEqual(new Set([3]));
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("WHERE s.user_id IN (?, ?)");
    expect(sql).toContain(activeSuspensionSql("s"));
    expect(sql).toMatch(/LOCK IN SHARE MODE$/);
    expect(params).toEqual([3, 4]);
  });
});
