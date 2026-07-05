import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { setUserRoles } from "@/lib/server/users-service";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

describe("setUserRoles", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("persists ADMIN via is_admin and cumulative roles via platform_roles_json", async () => {
    const execute = jest
      .fn()
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
      .fn()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setUserRoles(7, ["COMMUNITY_MANAGER"]);

    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([0, JSON.stringify(["COMMUNITY_MANAGER"]), 7]);
  });

  it("normalizes: dedupes, drops invalid roles, stable order", async () => {
    const execute = jest
      .fn()
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
      .fn()
      .mockResolvedValueOnce([[{ id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await setUserRoles(7, []);

    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([0, JSON.stringify([]), 7]);
  });

  it("throws USER_NOT_FOUND without updating when the user does not exist", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]); // existence check → empty
    await mockDb(execute);

    await expect(setUserRoles(999, ["ADMIN"])).rejects.toThrow("USER_NOT_FOUND");
    expect(execute).toHaveBeenCalledTimes(1); // no UPDATE issued
  });
});
