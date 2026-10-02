import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { setUserRoles } from "@/lib/server/users/roles";
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

    const result = await setUserRoles(7, ["ADMIN", "ARBITRE"]);

    expect(result).toEqual(["ADMIN", "ARBITRE"]);
    const [updateSql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toMatch(/UPDATE bg_users SET is_admin = \?, platform_roles_json = \?/);
    // is_admin = 1, JSON excludes ADMIN, target id last.
    expect(params).toEqual([1, JSON.stringify(["ARBITRE"]), 7]);
  });

  it("clears is_admin when ADMIN is absent", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setUserRoles(7, ["COMMUNITY_MANAGER"]);

    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([0, JSON.stringify(["COMMUNITY_MANAGER"]), 7]);
  });

  it("normalizes: dedupes, drops invalid roles, stable order", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    // @ts-expect-error — testing sanitization of untyped input
    const result = await setUserRoles(7, ["RECRUTEUR", "RECRUTEUR", "NOPE", "ARBITRE"]);

    expect(result).toEqual(["ARBITRE", "RECRUTEUR"]);
    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([0, JSON.stringify(["ARBITRE", "RECRUTEUR"]), 7]);
  });

  it("persists an empty roles set (revokes everything)", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setUserRoles(7, []);

    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([0, JSON.stringify([]), 7]);
  });

  it("throws USER_NOT_FOUND without updating when the user does not exist", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]); // existence check → empty
    await mockDb(execute);

    await expect(setUserRoles(999, ["ADMIN"])).rejects.toThrow("USER_NOT_FOUND");
    expect(execute).toHaveBeenCalledTimes(1); // no UPDATE issued
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

    await setUserRoles(7, []);

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeOther).not.toHaveBeenCalled();
    expect(registeredStreamCount()).toBe(1);
  });

  it("closes the streams on a role grant too, so the viewer context is recomputed", async () => {
    await mockDb(grantedDb());
    const close = jest.fn();
    registerSessionStream(7, "hash-a", close);

    await setUserRoles(7, ["ARBITRE"]);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("refuses a stream that read the session before the write, not one opened after", async () => {
    await mockDb(grantedDb());
    const mark = revocationMark();

    await setUserRoles(7, []);

    expect(revokedSince(7, "hash-a", mark)).toBe(true);
    expect(revokedSince(8, "hash-c", mark)).toBe(false);
    expect(revokedSince(7, "hash-a", revocationMark())).toBe(false);
  });

  it("leaves the streams open when the user does not exist", async () => {
    await mockDb(jest.fn<SqlQuery>().mockResolvedValueOnce([[]]));
    const close = jest.fn();
    registerSessionStream(999, "hash-a", close);

    await expect(setUserRoles(999, ["ADMIN"])).rejects.toThrow("USER_NOT_FOUND");

    expect(close).not.toHaveBeenCalled();
  });

  it("leaves the streams open when the account vanished between the check and the write", async () => {
    await mockDb(
      jest
        .fn<SqlQuery>()
        .mockResolvedValueOnce([[{ id: 7 }]])
        .mockResolvedValueOnce([{ affectedRows: 0 }]),
    );
    const close = jest.fn();
    registerSessionStream(7, "hash-a", close);

    await expect(setUserRoles(7, [])).rejects.toThrow("USER_NOT_FOUND");

    expect(close).not.toHaveBeenCalled();
  });
});
