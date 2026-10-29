import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { rolesChangeAuditLine, setOwnPlatformRoles, setUserRoles } from "@/lib/server/users/roles";
import {
  registerSessionStream,
  registeredStreamCount,
  resetSessionStreams,
  revocationMark,
  revokedSince,
} from "@/lib/server/session-streams";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

describe("setUserRoles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("persists ADMIN via is_admin and cumulative roles via platform_roles_json", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7 }]]) // existence check
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // update
    await mockDb(execute);

    const result = await setUserRoles(7, ["ADMIN", "ARBITRE"], 1);

    expect(result).toEqual(["ADMIN", "ARBITRE"]);
    const [updateSql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toMatch(/SET target\.is_admin = \?, target\.platform_roles_json = \?/);
    // Actor id first (still-admin guard), is_admin = 1, JSON excludes ADMIN, target id last.
    expect(params).toEqual([1, 1, JSON.stringify(["ARBITRE"]), 7]);
  });

  it("clears is_admin when ADMIN is absent", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setUserRoles(7, ["COMMUNITY_MANAGER"], 1);

    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([1, 0, JSON.stringify(["COMMUNITY_MANAGER"]), 7]);
  });

  it("normalizes: dedupes, drops invalid roles, stable order", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    // @ts-expect-error — testing sanitization of untyped input
    const result = await setUserRoles(7, ["RECRUTEUR", "RECRUTEUR", "NOPE", "ARBITRE"], 1);

    expect(result).toEqual(["ARBITRE", "RECRUTEUR"]);
    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([1, 0, JSON.stringify(["ARBITRE", "RECRUTEUR"]), 7]);
  });

  it("persists an empty roles set (revokes everything)", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setUserRoles(7, [], 1);

    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([1, 0, JSON.stringify([]), 7]);
  });

  it("throws USER_NOT_FOUND without updating when the user does not exist", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]); // existence check → empty
    await mockDb(execute);

    await expect(setUserRoles(999, ["ADMIN"], 1)).rejects.toThrow("USER_NOT_FOUND");
    expect(execute).toHaveBeenCalledTimes(1); // no UPDATE issued
  });
});

describe("setUserRoles — the actor must still be an administrator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionStreams();
  });

  it("setUserRoles_write_joinsActorRowRequiringLiveAdmin", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setUserRoles(7, ["ARBITRE"], 3);

    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/JOIN bg_users AS actor ON actor\.id = \? AND actor\.is_admin = 1 AND actor\.is_deleted = 0/);
    expect(params[0]).toBe(3);
  });

  it("setUserRoles_actorDemotedConcurrently_throwsNotAdminAndKeepsStreams", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[]]); // the actor is no longer an administrator
    await mockDb(execute);
    const close = jest.fn();
    registerSessionStream(7, "hash-a", close);

    await expect(setUserRoles(7, [], 3)).rejects.toThrow("NOT_ADMIN");

    const [reasonSql, reasonParams] = execute.mock.calls[2] as [string, unknown[]];
    expect(reasonSql).toMatch(/is_admin = 1 AND is_deleted = 0/);
    expect(reasonParams).toEqual([3]);
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

  function grantedDb() {
    return jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
  }

  it("closes every open stream of the target user once the roles are written", async () => {
    await mockDb(grantedDb());
    const closeA = jest.fn();
    const closeB = jest.fn();
    const closeOther = jest.fn();
    registerSessionStream(7, "hash-a", closeA);
    registerSessionStream(7, "hash-b", closeB);
    registerSessionStream(8, "hash-c", closeOther);

    await setUserRoles(7, [], 1);

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeOther).not.toHaveBeenCalled();
    expect(registeredStreamCount()).toBe(1);
  });

  it("closes the streams on a role grant too, so the viewer context is recomputed", async () => {
    await mockDb(grantedDb());
    const close = jest.fn();
    registerSessionStream(7, "hash-a", close);

    await setUserRoles(7, ["ARBITRE"], 1);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("refuses a stream that read the session before the write, not one opened after", async () => {
    await mockDb(grantedDb());
    const mark = revocationMark();

    await setUserRoles(7, [], 1);

    expect(revokedSince(7, "hash-a", mark)).toBe(true);
    expect(revokedSince(8, "hash-c", mark)).toBe(false);
    expect(revokedSince(7, "hash-a", revocationMark())).toBe(false);
  });

  it("leaves the streams open when the user does not exist", async () => {
    await mockDb(jest.fn<SqlQuery>().mockResolvedValueOnce([[]]));
    const close = jest.fn();
    registerSessionStream(999, "hash-a", close);

    await expect(setUserRoles(999, ["ADMIN"], 1)).rejects.toThrow("USER_NOT_FOUND");

    expect(close).not.toHaveBeenCalled();
  });

  it("leaves the streams open when the account vanished between the check and the write", async () => {
    await mockDb(
      jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[{ id: 7 }]])
        .mockResolvedValueOnce([{ affectedRows: 0 }])
        .mockResolvedValueOnce([[{ id: 1 }]]), // actor still admin
    );
    const close = jest.fn();
    registerSessionStream(7, "hash-a", close);

    await expect(setUserRoles(7, [], 1)).rejects.toThrow("USER_NOT_FOUND");

    expect(close).not.toHaveBeenCalled();
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
