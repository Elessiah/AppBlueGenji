import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ResultSetHeader } from "mysql2/promise";
import { liftStrayImpersonations } from "@/lib/server/database/catch-ups";
import { applyRecentSchemaChanges } from "@/lib/server/database/recent-schema-changes";
import { PLAYER_VIEW_OFF_AUDIT } from "@/lib/server/player-view-audit";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Balayage du démarrage (`ADMIN_ROLE_IMPERSONATION.md`) : une incarnation en
 * cours sur la session d'un compte qui n'est pas administrateur est levée —
 * échéance et rôles —, en deux temps, sans verrou sur `bg_users`.
 */

const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const header = (affectedRows: number) => ({ affectedRows }) as ResultSetHeader;
const unknownColumn = Object.assign(new Error("Unknown column 'impersonated_roles_json'"), {
  code: "ER_BAD_FIELD_ERROR",
  errno: 1054,
});

let info: jest.SpiedFunction<typeof console.info>;

beforeEach(() => {
  info = jest.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** Double : la lecture rend `ids`, la mise à jour rend `affected`. */
function pool(ids: number[], affected = ids.length) {
  const execute = jest
    .fn<SqlQuery>()
    .mockImplementation(async (sql) =>
      String(sql).trimStart().startsWith("SELECT") ? [ids.map((id) => ({ id })), []] : [header(affected), []],
    );
  return { execute, db: fakePool({ execute }) };
}

describe("liftStrayImpersonations", () => {
  it("liftStrayImpersonations_noStraySession_issuesNoUpdateAndNoLine", async () => {
    const { execute, db } = pool([]);

    await liftStrayImpersonations(db);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
  });

  it("liftStrayImpersonations_select_readsWithoutLockActiveDeadlinesOfNonAdmins", async () => {
    const { execute, db } = pool([]);

    await liftStrayImpersonations(db);

    expect(oneLine(String(execute.mock.calls[0]?.[0]))).toBe(
      "SELECT s.id FROM bg_user_sessions s JOIN bg_users u ON u.id = s.user_id WHERE s.player_view_until > NOW() AND (u.is_admin = 0 OR u.is_deleted = 1)",
    );
  });

  it("liftStrayImpersonations_straySessions_clearsDeadlineAndRolesByIdsOnly", async () => {
    const { execute, db } = pool([4, 9]);

    await liftStrayImpersonations(db);

    expect(oneLine(String(execute.mock.calls[1]?.[0]))).toBe(
      "UPDATE bg_user_sessions SET player_view_until = NULL, impersonated_roles_json = NULL WHERE id IN (?, ?) AND player_view_until > NOW()",
    );
    expect(execute.mock.calls[1]?.[1]).toEqual([4, 9]);
  });

  it("liftStrayImpersonations_lifted_logsCountWithoutName", async () => {
    const { db } = pool([4, 9], 2);

    await liftStrayImpersonations(db);

    expect(info).toHaveBeenCalledWith(`${PLAYER_VIEW_OFF_AUDIT} : levée au démarrage, compte sans administration (2 session(s))`);
  });

  it("liftStrayImpersonations_nothingAffected_logsNothing", async () => {
    const { db } = pool([4], 0);

    await liftStrayImpersonations(db);

    expect(info).not.toHaveBeenCalled();
  });

  it("liftStrayImpersonations_rolesColumnMissing_clearsDeadlineOnly", async () => {
    const { execute, db } = pool([4]);
    execute.mockImplementationOnce(async () => [[{ id: 4 }], []]).mockRejectedValueOnce(unknownColumn);

    await liftStrayImpersonations(db);

    expect(oneLine(String(execute.mock.calls[2]?.[0]))).toBe(
      "UPDATE bg_user_sessions SET player_view_until = NULL WHERE id IN (?) AND player_view_until > NOW()",
    );
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("liftStrayImpersonations_selectFails_swallowsError", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));

    await expect(liftStrayImpersonations(fakePool({ execute }))).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("liftStrayImpersonations_updateFails_swallowsError", async () => {
    const { execute, db } = pool([4]);
    execute.mockImplementationOnce(async () => [[{ id: 4 }], []]).mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));

    await expect(liftStrayImpersonations(db)).resolves.toBeUndefined();

    expect(info).not.toHaveBeenCalled();
  });
});

describe("RECENT_SCHEMA_CHANGES — plus de rattrapage des sessions", () => {
  it("applyRecentSchemaChanges_noLongerClearsSessions", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([header(0), []]);

    await applyRecentSchemaChanges(fakePool({ execute }));

    expect(execute.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE bg_user_sessions"))).toBe(false);
  });
});
