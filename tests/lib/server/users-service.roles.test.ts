import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { rolesChangeAuditLine, setOwnPlatformRoles, setUserRoles } from "@/lib/server/users/roles";
import {
  registerSessionStream,
  registeredStreamCount,
  resetSessionStreams,
  revocationMark,
  revokedSince,
} from "@/lib/server/session-streams";
import { type SqlQuery, connectionMock, fakeConnection, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

/**
 * `setUserRoles` : la cible lue sur le pool (`targetRows`), puis une
 * transaction, sur une connexion.
 */
async function mockTransaction(targetRows: object[] = [{ id: 7 }]) {
  const connection = connectionMock();
  connection.rollback.mockResolvedValue(undefined);
  connection.commit.mockResolvedValue(undefined);
  const poolExecute = jest.fn<SqlQuery>().mockResolvedValue([targetRows]);
  const getConnection = jest.fn(async () => fakeConnection(connection));
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: poolExecute, getConnection }));
  return Object.assign(connection, { poolExecute, getConnection });
}

const ACTOR_ADMIN = { id: 3, is_admin: 1 };
const TARGET = { id: 7, is_admin: 0, platform_roles_json: "[]" };

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

    expect(result).toEqual({ roles: ["ARBITRE"], previous: [] });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    const [lockSql, lockParams] = connection.execute.mock.calls[0] as [string, unknown[]];
    expect(lockSql).toBe(
      "SELECT id, is_admin, platform_roles_json FROM bg_users WHERE id IN (?, ?) AND is_deleted = 0 ORDER BY id FOR UPDATE",
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

    expect(result.roles).toEqual(["ADMIN", "ARBITRE"]);
    const [, params] = connection.execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([1, JSON.stringify(["ARBITRE"]), 7]);
  });

  it("setUserRoles_duplicatesAndUnknownValues_normalizesBeforeWrite", async () => {
    const connection = await mockTransaction();
    lockedThenWritten(connection, [ACTOR_ADMIN, TARGET]);

    // @ts-expect-error — testing sanitization of untyped input
    const result = await setUserRoles(7, ["RECRUTEUR", "RECRUTEUR", "NOPE", "ARBITRE"], 3);

    expect(result.roles).toEqual(["ARBITRE", "RECRUTEUR"]);
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

  it("setUserRoles_targetIdMatchesNoRow_throwsUserNotFoundBeforeAnyTransaction", async () => {
    // Un identifiant au-delà du plus grand : refusé sans verrou d'intervalle.
    const connection = await mockTransaction([]);

    await expect(setUserRoles(999, ["ADMIN"], 3)).rejects.toThrow("USER_NOT_FOUND");

    expect(connection.poolExecute).toHaveBeenCalledWith("SELECT id FROM bg_users WHERE id = ? LIMIT 1", [999]);
    expect(connection.getConnection).not.toHaveBeenCalled();
    expect(connection.beginTransaction).not.toHaveBeenCalled();
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

  it("setUserRoles_rollbackFails_keepsOriginalErrorAndDestroysConnection", async () => {
    const connection = await mockTransaction();
    connection.execute
      .mockResolvedValueOnce([[ACTOR_ADMIN, TARGET]])
      .mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));
    connection.rollback.mockRejectedValueOnce(new Error("connection lost"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(setUserRoles(7, [], 3)).rejects.toThrow("ER_LOCK_DEADLOCK");

    // Transaction peut-être encore ouverte : la connexion n'est pas rendue au pool.
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    logged.mockRestore();
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

describe("setUserRoles — roles read under the lock (expected roles)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionStreams();
  });
  afterEach(() => {
    resetSessionStreams();
  });

  it("setUserRoles_storedRoles_returnsThemAsPrevious", async () => {
    const connection = await mockTransaction();
    lockedThenWritten(connection, [ACTOR_ADMIN, { id: 7, is_admin: 1, platform_roles_json: '["CASTER"]' }]);

    const result = await setUserRoles(7, ["ARBITRE"], 3);

    expect(result.previous).toEqual(["ADMIN", "CASTER"]);
  });

  it("setUserRoles_expectedMatchesStored_writes", async () => {
    const connection = await mockTransaction();
    lockedThenWritten(connection, [ACTOR_ADMIN, { id: 7, is_admin: 0, platform_roles_json: '["CASTER"]' }]);

    await setUserRoles(7, ["ARBITRE"], 3, ["CASTER"]);

    expect(connection.execute).toHaveBeenCalledTimes(2);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("setUserRoles_expectedSameRolesInOtherOrder_writes", async () => {
    const connection = await mockTransaction();
    lockedThenWritten(connection, [ACTOR_ADMIN, { id: 7, is_admin: 1, platform_roles_json: '["CASTER","ARBITRE"]' }]);

    await setUserRoles(7, [], 3, ["ARBITRE", "CASTER", "ADMIN"]);

    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("setUserRoles_expectedDiffersFromStored_throwsRolesChangedWithoutWriting", async () => {
    // Un autre réglage a abouti depuis l'ouverture de la fiche : l'écraser
    // sans le dire, c'était la dernière écriture gagnante.
    const connection = await mockTransaction();
    connection.execute.mockResolvedValueOnce([[ACTOR_ADMIN, { id: 7, is_admin: 0, platform_roles_json: '["ARBITRE"]' }]]);
    const close = jest.fn();
    registerSessionStream(7, "hash-a", close);

    await expect(setUserRoles(7, ["CASTER"], 3, [])).rejects.toThrow("ROLES_CHANGED");

    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

/** `setOwnPlatformRoles` : sa ligne verrouillée, puis l'écriture, sur une connexion. */
async function mockOwnTransaction(row: object | null) {
  const connection = await mockTransaction();
  connection.execute.mockResolvedValueOnce([row ? [row] : []]).mockResolvedValueOnce([{ affectedRows: 1 }]);
  return connection;
}

const OWN_ADMIN = { is_admin: 1, is_deleted: 0, platform_roles_json: '["CASTER"]' };

describe("setOwnPlatformRoles (ADMIN-SELF-ROLES)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionStreams();
  });
  afterEach(() => {
    resetSessionStreams();
  });

  it("setOwnPlatformRoles_adminKeptWithScopedRoles_locksOwnRowFirstThenWritesOnlyScopedJson", async () => {
    const connection = await mockOwnTransaction(OWN_ADMIN);

    const result = await setOwnPlatformRoles(1, ["ADMIN", "ARBITRE"]);

    expect(result).toEqual({ roles: ["ADMIN", "ARBITRE"], previous: ["ADMIN", "CASTER"] });
    const [lockSql, lockParams] = connection.execute.mock.calls[0] as [string, unknown[]];
    expect(lockSql).toBe("SELECT is_admin, is_deleted, platform_roles_json FROM bg_users WHERE id = ? FOR UPDATE");
    expect(lockParams).toEqual([1]);
    const [sql, params] = connection.execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE bg_users SET platform_roles_json = \? WHERE id = \? AND is_deleted = 0 AND is_admin = 1/);
    expect(sql).not.toMatch(/SET is_admin/);
    expect(params).toEqual([JSON.stringify(["ARBITRE"]), 1]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("setOwnPlatformRoles_selectionWithoutAdmin_throwsCannotRemoveOwnAdminWithoutQuery", async () => {
    const connection = await mockTransaction();

    await expect(setOwnPlatformRoles(1, ["ARBITRE"])).rejects.toThrow("CANNOT_REMOVE_OWN_ADMIN");

    expect(connection.execute).not.toHaveBeenCalled();
    expect(connection.getConnection).not.toHaveBeenCalled();
  });

  it("setOwnPlatformRoles_demotedConcurrently_throwsNotAdminWithoutWritingAndKeepsStreams", async () => {
    // Un autre administrateur a retiré `is_admin` entre la lecture de la
    // session et l'écriture : la ligne verrouillée le dit.
    const connection = await mockOwnTransaction({ ...OWN_ADMIN, is_admin: 0 });
    const close = jest.fn();
    registerSessionStream(1, "hash-a", close);

    await expect(setOwnPlatformRoles(1, ["ADMIN", "CASTER"])).rejects.toThrow("NOT_ADMIN");

    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("setOwnPlatformRoles_accountDeletedConcurrently_throwsUserNotFound", async () => {
    // « Tu n'es plus administrateur » serait faux pour un compte supprimé.
    await mockOwnTransaction({ ...OWN_ADMIN, is_deleted: 1 });

    await expect(setOwnPlatformRoles(1, ["ADMIN"])).rejects.toThrow("USER_NOT_FOUND");
  });

  it("setOwnPlatformRoles_rowGone_throwsUserNotFound", async () => {
    await mockOwnTransaction(null);

    await expect(setOwnPlatformRoles(1, ["ADMIN"])).rejects.toThrow("USER_NOT_FOUND");
  });

  it("setOwnPlatformRoles_expectedDiffersFromStored_throwsRolesChangedWithoutWriting", async () => {
    const connection = await mockOwnTransaction(OWN_ADMIN);

    await expect(setOwnPlatformRoles(1, ["ADMIN", "ARBITRE"], ["ADMIN"])).rejects.toThrow("ROLES_CHANGED");

    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it("setOwnPlatformRoles_expectedMatchesStored_writes", async () => {
    const connection = await mockOwnTransaction(OWN_ADMIN);

    await setOwnPlatformRoles(1, ["ADMIN"], ["CASTER", "ADMIN"]);

    expect(connection.execute).toHaveBeenCalledTimes(2);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it("setOwnPlatformRoles_duplicatesAndUnknownValues_normalizesBeforeWrite", async () => {
    const connection = await mockOwnTransaction(OWN_ADMIN);

    // @ts-expect-error — testing sanitization of untyped input
    const result = await setOwnPlatformRoles(1, ["RECRUTEUR", "ADMIN", "RECRUTEUR", "NOPE"]);

    expect(result.roles).toEqual(["ADMIN", "RECRUTEUR"]);
    const [, params] = connection.execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([JSON.stringify(["RECRUTEUR"]), 1]);
  });

  it("setOwnPlatformRoles_success_keepsStreamsOpen", async () => {
    // Un administrateur tient toutes les permissions : ses flux de tournoi
    // n'ont rien à recalculer, aucun n'est fermé.
    await mockOwnTransaction(OWN_ADMIN);
    const own = jest.fn();
    registerSessionStream(1, "hash-a", own);

    await setOwnPlatformRoles(1, ["ADMIN"]);

    expect(own).not.toHaveBeenCalled();
  });
});

describe("rolesChangeAuditLine", () => {
  it("rolesChangeAuditLine_otherAccount_namesTargetGrantedRemovedAndSaved", () => {
    expect(rolesChangeAuditLine(7, { roles: ["ARBITRE", "RECRUTEUR"], previous: ["CASTER", "RECRUTEUR"] }, false)).toBe(
      "🛡️ Rôles de plateforme du compte #7 — accordés : Arbitre ; retirés : Caster ; enregistrés : Arbitre, Recruteur.",
    );
  });

  it("rolesChangeAuditLine_ownAccount_saysOwnAccount", () => {
    expect(rolesChangeAuditLine(1, { roles: ["ADMIN", "CASTER"], previous: ["ADMIN"] }, true)).toBe(
      "🛡️ Rôles de plateforme de son propre compte (#1) — accordés : Caster ; retirés : aucun ; enregistrés : Administrateur, Caster.",
    );
  });

  it("rolesChangeAuditLine_everythingRemoved_saysAucunForGrantedAndSaved", () => {
    expect(rolesChangeAuditLine(7, { roles: [], previous: ["ARBITRE"] }, false)).toBe(
      "🛡️ Rôles de plateforme du compte #7 — accordés : aucun ; retirés : Arbitre ; enregistrés : aucun.",
    );
  });
});
