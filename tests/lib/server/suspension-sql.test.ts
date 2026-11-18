import { describe, expect, it } from "@jest/globals";
import { activeSuspensionSql, userSuspendedSql } from "@/lib/server/suspension-sql";

describe("userSuspendedSql", () => {
  it("userSuspendedSql_column_existsOnThatColumnWithActiveCondition", () => {
    expect(userSuspendedSql("u.id")).toBe(
      `EXISTS (SELECT 1 FROM bg_account_suspensions sus WHERE sus.user_id = u.id AND ${activeSuspensionSql("sus")})`,
    );
  });
});
