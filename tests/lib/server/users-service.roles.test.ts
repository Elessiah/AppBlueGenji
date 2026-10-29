import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { rolesChangeAuditLine, setOwnPlatformRoles, setUserRoles } from "@/lib/server/users/roles";
import {
  registerSessionStream,
  registeredStreamCount,
  resetSessionStreams,
  revocationMark,
  revokedSince,
} from "@/lib/server/session-streams";
import { type SqlQuery, type SqlMock, connectionMock, fakeConnection, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

/** `setOwnPlatformRoles` : une instruction seule, sur le pool. */
async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

/** `setUserRoles` : une transaction, sur une connexion. */
async function mockTransaction() {
  const connection = connectionMock();
  connection.rollback.mockResolvedValue(undefined);
  connection.commit.mockResolvedValue(undefined);
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ getConnection: async () => fakeConnection(connection) }));
  return connection;
}

const ACTOR_ADMIN = { id: 3, is_admin: 1 };
const TARGET = { id: 7, is_admin: 0 };

/** Verrou des deux lignes, puis l'écriture. */
function lockedThenWritten(connection: ReturnType<typeof connectionMock>, rows: object[]) {
  connection.execute.mockResolvedValueOnce([rows]).mockResolvedValueOnce([{ affectedRows: 1 }]);
}

describe("setUserRoles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionStreams();
  });
  afterEach(() => {
    resetSessionStreams();
  });

  it("setUserRoles_bothRowsLive_locksBothRowsFirstInIdOrderThenUpdatesAndCommits", async () => {
    const connection = await mockTransaction();
    lockedThenWritten(connection, [ACTOR_ADMIN, TARGET]);

    const result = await setUserRoles(7, ["ARBITRE"], 3);

    expect(result).toEqual(["ARBITRE"]);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    const [lockSql, lockParams] = connection.execute.mock.calls[0] as [string, unknown[]];
    expect(lockSql).toBe(
      "SELECT id, is_admin FROM bg_users WHERE id IN (?, ?) AND is_deleted = 0 ORDER BY id FOR UPDATE",
    );
    expect(lockParams).toEqual([3, 7]);
    const [updateSql, updateParams] = connection.execute.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toBe("UPDATE bg_users SET is_admin = ?, platform_roles_json = ? WHERE id = ? AND is_deleted = 0");
    expect(updateParams).toEqual([0, JSON.stringify(["ARBITRE"]), 7]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("setUserRoles_adminGranted_persistsIsAdminAndKeepsAdminOutOfJson", async () => {
    const connection = await mockTransaction();
    lockedThenWritten(connection, [ACTOR_ADMIN, TARGET]);

    const result = await setUserRoles(7, ["ADMIN", "ARBITRE"], 3);

    expect(result).toEqual(["ADMIN", "ARBITRE"]);
    const [, params] = connection.execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([1, JSON.stringify(["ARBITRE"]), 7]);
  });

  it("setUserRoles_duplicatesAndUnknownValues_normalizesBeforeWrite", async () => {
    const connection = await mockTransaction();
    lockedThenWritten(connection, [ACTOR_ADMIN, TARGET]);

    // @ts-expect-error — testing sanitization of untyped input
    const result = await setUserRoles(7, ["RECRUTEUR", "RECRUTEUR", "NOPE", "ARBITRE"], 3);

    expect(result).toEqual(["ARBITRE", "RECRUTEUR"]);
    const [, params] = connection.execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([0, JSON.stringify(["ARBITRE", "RECRUTEUR"]), 7]);
  });

  it("setUserRoles_emptySelection_revokesEverything", async () => {
    const connection = await mockTransaction();
    lockedThenWritten(connection, [ACTOR_ADMIN, TARGET]);

    await setUserRoles(7, [], 3);

    const [, params] = connection.execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([0, JSON.stringify([]), 7]);
  });

  it("setUserRoles_lockQuery_hasNoJoinAndNoMariaDbIncompatibleClause", async () => {
    const connection = await mockTransaction();
    lockedThenWritten(connection, [ACTOR_ADMIN, TARGET]);

    await setUserRoles(7, ["ARBITRE"], 3);

    const [lockSql] = connection.execute.mock.calls[0] as [string];
    const [updateSql] = connection.execute.mock.calls[1] as [string];
    expect(lockSql).not.toMatch(/\bJOIN\b|FOR\s+UPDATE\s+OF|FOR\s+SHARE/i);
    expect(updateSql).not.toMatch(/\bJOIN\b/i);
  });
});

describe("setUserRoles — the actor must still be an administrator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionStreams();
  });
  afterEach(() => {
    resetSessionStreams();
  });

  it("setUserRoles_actorRowMissing_throwsNotAdminRollsBackWithoutUpdate", async () => {
    const connection = await mockTransaction();
    connection.execute.mockResolvedValueOnce([[TARGET]]);
    const close = jest.fn();
    registerSessionStream(7, "hash-a", close);

    await expect(setUserRoles(7, [], 3)).rejects.toThrow("NOT_ADMIN");

    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("setUserRoles_actorDemoted_throwsNotAdmin", async () => {
    const connection = await mockTransaction();
    connection.execute.mockResolvedValueOnce([[{ id: 3, is_admin: 0 }, TARGET]]);

    await expect(setUserRoles(7, ["ADMIN"], 3)).rejects.toThrow("NOT_ADMIN");

    expect(connection.execute).toHaveBeenCalledTimes(1);
  });

  it("setUserRoles_actorDemotedAndTargetMissing_throwsNotAdminFirst", async () => {
    const connection = await mockTransaction();
    connection.execute.mockResolvedValueOnce([[]]);

    await expect(setUserRoles(999, ["ADMIN"], 3)).rejects.toThrow("NOT_ADMIN");
  });
});

describe("setUserRoles — failures leave nothing behind", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionStreams();
  });
  afterEach(() => {
    resetSessionStreams();
  });

  it("setUserRoles_targetMissing_throwsUserNotFoundRollsBack", async () => {
    const connection = await mockTransaction();
    connection.execute.mockResolvedValueOnce([[ACTOR_ADMIN]]);
    const close = jest.fn();
    registerSessionStream(999, "hash-a", close);

    await expect(setUserRoles(999, ["ADMIN"], 3)).rejects.toThrow("USER_NOT_FOUND");

    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("setUserRoles_updateFails_rollsBackReleasesAndRethrows", async () => {
    const connection = await mockTransaction();
    connection.execute
      .mockResolvedValueOnce([[ACTOR_ADMIN, TARGET]])
      .mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));
    const close = jest.fn();
    registerSessionStream(7, "hash-a", close);

    await expect(setUserRoles(7, [], 3)).rejects.toThrow("ER_LOCK_DEADLOCK");

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("setUserRoles_commitFails_rollsBackAndRethrows", async () => {
    const connection = await mockTransaction();
    lockedThenWritten(connection, [ACTOR_ADMIN, TARGET]);
    connection.commit.mockRejectedValueOnce(new Error("COMMIT_FAILED"));
    const close = jest.fn();
    registerSessionStream(7, "hash-a", close);

    await expect(setUserRoles(7, [], 3)).rejects.toThrow("COMMIT_FAILED");

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });
});

describe("setUserRoles — open tournament streams", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionStreams();
  });
  afterEach(() => {
    resetSessionStreams();
  });

  it("closes every open stream of the target user once the roles are written", async () => {
    lockedThenWritten(await mockTransaction(), [ACTOR_ADMIN, TARGET]);
    const closeA = jest.fn();
    const closeB = jest.fn();
    const closeOther = jest.fn();
    registerSessionStream(7, "hash-a", closeA);
    registerSessionStream(7, "hash-b", closeB);
    registerSessionStream(8, "hash-c", closeOther);

    await setUserRoles(7, [], 3);

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeOther).not.toHaveBeenCalled();
    expect(registeredStreamCount()).toBe(1);
  });

  it("closes the streams on a role grant too, so the viewer context is recomputed", async () => {
    lockedThenWritten(await mockTransaction(), [ACTOR_ADMIN, TARGET]);
    const close = jest.fn();
    registerSessionStream(7, "hash-a", close);

    await setUserRoles(7, ["ARBITRE"], 3);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("refuses a stream that read the session before the write, not one opened after", async () => {
    lockedThenWritten(await mockTransaction(), [ACTOR_ADMIN, TARGET]);
    const mark = revocationMark();

    await setUserRoles(7, [], 3);

    expect(revokedSince(7, "hash-a", mark)).toBe(true);
    expect(revokedSince(8, "hash-c", mark)).toBe(false);
    expect(revokedSince(7, "hash-a", revocationMark())).toBe(false);
  });
});

describe("setOwnPlatformRoles (ADMIN-SELF-ROLES)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionStreams();
  });
  afterEach(() => {
    resetSessionStreams();
  });

  it("setOwnPlatformRoles_adminKeptWithScopedRoles_writesOnlyScopedJsonUnderIsAdminGuard", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    const result = await setOwnPlatformRoles(1, ["ADMIN", "ARBITRE"]);

    expect(result).toEqual(["ADMIN", "ARBITRE"]);
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE bg_users SET platform_roles_json = \? WHERE id = \? AND is_deleted = 0 AND is_admin = 1/);
    expect(sql).not.toMatch(/SET is_admin/);
    expect(params).toEqual([JSON.stringify(["ARBITRE"]), 1]);
  });

  it("setOwnPlatformRoles_selectionWithoutAdmin_throwsCannotRemoveOwnAdminWithoutQuery", async () => {
    const execute = jest.fn<SqlQuery>();
    await mockDb(execute);

    await expect(setOwnPlatformRoles(1, ["ARBITRE"])).rejects.toThrow("CANNOT_REMOVE_OWN_ADMIN");

    expect(execute).not.toHaveBeenCalled();
  });

  it("setOwnPlatformRoles_demotedConcurrently_throwsNotAdminAndKeepsStreams", async () => {
    // Un autre administrateur a retiré `is_admin` entre la lecture de la
    // session et l'écriture : la condition ne trouve plus la ligne.
    await mockDb(jest.fn<SqlQuery>().mockResolvedValueOnce([{ affectedRows: 0 }]));
    const close = jest.fn();
    registerSessionStream(1, "hash-a", close);

    await expect(setOwnPlatformRoles(1, ["ADMIN", "CASTER"])).rejects.toThrow("NOT_ADMIN");

    expect(close).not.toHaveBeenCalled();
  });

  it("setOwnPlatformRoles_duplicatesAndUnknownValues_normalizesBeforeWrite", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    // @ts-expect-error — testing sanitization of untyped input
    const result = await setOwnPlatformRoles(1, ["RECRUTEUR", "ADMIN", "RECRUTEUR", "NOPE"]);

    expect(result).toEqual(["ADMIN", "RECRUTEUR"]);
    const [, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([JSON.stringify(["RECRUTEUR"]), 1]);
  });

  it("setOwnPlatformRoles_success_closesOwnStreamsOnly", async () => {
    await mockDb(jest.fn<SqlQuery>().mockResolvedValueOnce([{ affectedRows: 1 }]));
    const own = jest.fn();
    const other = jest.fn();
    registerSessionStream(1, "hash-a", own);
    registerSessionStream(2, "hash-b", other);

    await setOwnPlatformRoles(1, ["ADMIN"]);

    expect(own).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });
});

describe("rolesChangeAuditLine", () => {
  it("rolesChangeAuditLine_otherAccount_namesTargetIdAndSavedRoles", () => {
    expect(rolesChangeAuditLine(7, ["ARBITRE", "RECRUTEUR"], false)).toBe(
      "🛡️ Rôles de plateforme du compte #7 enregistrés : Arbitre, Recruteur.",
    );
  });

  it("rolesChangeAuditLine_ownAccount_saysOwnAccount", () => {
    expect(rolesChangeAuditLine(1, ["ADMIN", "CASTER"], true)).toBe(
      "🛡️ Rôles de plateforme de son propre compte (#1) enregistrés : Administrateur, Caster.",
    );
  });

  it("rolesChangeAuditLine_noRoles_saysAucun", () => {
    expect(rolesChangeAuditLine(7, [], false)).toBe("🛡️ Rôles de plateforme du compte #7 enregistrés : aucun.");
  });
});
