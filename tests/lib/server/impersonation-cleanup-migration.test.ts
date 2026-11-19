import { describe, expect, it, jest } from "@jest/globals";
import { applyRecentSchemaChanges } from "@/lib/server/database/recent-schema-changes";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Rattrapage de l'incarnation (`ADMIN_ROLE_IMPERSONATION.md`) : une échéance en
 * cours sur la session d'un compte qui n'est pas administrateur est levée au
 * démarrage, sans quoi elle revenait si le compte le redevenait.
 */

const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();

async function cleanupStatement(): Promise<string | undefined> {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }]);
  await applyRecentSchemaChanges(fakePool({ execute }));
  return execute.mock.calls
    .map(([sql]) => oneLine(String(sql)))
    .find((sql) => sql.startsWith("UPDATE bg_user_sessions SET player_view_until = NULL"));
}

describe("RECENT_SCHEMA_CHANGES — rattrapage de l'incarnation", () => {
  it("recentSchemaChanges_impersonationCleanup_targetsOnlyActiveDeadlinesOfNonAdmins", async () => {
    const cleanup = await cleanupStatement();

    expect(cleanup).toBe(
      "UPDATE bg_user_sessions SET player_view_until = NULL WHERE player_view_until > NOW() AND user_id IN (SELECT id FROM bg_users WHERE is_admin = 0 OR is_deleted = 1)",
    );
  });
});
