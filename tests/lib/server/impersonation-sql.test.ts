import { describe, expect, it, jest } from "@jest/globals";
import type { ResultSetHeader } from "mysql2/promise";
import { liftImpersonations } from "@/lib/server/impersonation-sql";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/** SQL commun de la levée d'une incarnation (`ADMIN_ROLE_IMPERSONATION.md`). */

const oneLine = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();
const header = (affectedRows: number) => ({ affectedRows }) as ResultSetHeader;

describe("liftImpersonations", () => {
  it("liftImpersonations_where_wrapsConditionAndKeepsActiveDeadlineGuard", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([header(2), []]);

    const lifted = await liftImpersonations(fakeConnection({ execute }), "id = ? OR id = ?", [4, 9]);

    expect(lifted).toBe(2);
    expect(oneLine(execute.mock.calls[0]?.[0])).toBe(
      "UPDATE bg_user_sessions SET player_view_until = NULL, impersonated_roles_json = NULL WHERE (id = ? OR id = ?) AND player_view_until > NOW()",
    );
    expect(execute.mock.calls[0]?.[1]).toEqual([4, 9]);
  });

  it("liftImpersonations_otherError_propagatesWithoutRetry", async () => {
    const deadlock = Object.assign(new Error("Deadlock"), { code: "ER_LOCK_DEADLOCK" });
    const execute = jest.fn<SqlQuery>().mockRejectedValue(deadlock);

    await expect(liftImpersonations(fakeConnection({ execute }), "user_id = ?", [7])).rejects.toBe(deadlock);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  // Revue sécurité 5 : sans la colonne de l'échéance, aucune incarnation ne
  // peut exister — un changement d'administration ne doit pas échouer.
  it("liftImpersonations_deadlineColumnMissing_returnsZero", async () => {
    const unknown = Object.assign(new Error("Unknown column 'player_view_until'"), { code: "ER_BAD_FIELD_ERROR" });
    const execute = jest.fn<SqlQuery>().mockRejectedValue(unknown);

    const lifted = await liftImpersonations(fakeConnection({ execute }), "user_id = ?", [7]);

    expect(lifted).toBe(0);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
