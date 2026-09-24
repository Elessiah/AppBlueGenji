import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { discordAccountExists } from "@/lib/server/users-service";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

describe("discordAccountExists", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renvoie true quand un compte porte déjà cet identifiant Discord", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[{ id: 42 }]]);
    await mockDb(execute);

    await expect(discordAccountExists("123456789012345678")).resolves.toBe(true);

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/SELECT id FROM bg_users WHERE discord_id = \?/);
    expect(params).toEqual(["123456789012345678"]);
  });

  it("renvoie false quand aucun compte n'est rattaché (première connexion)", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(discordAccountExists("999888777666555444")).resolves.toBe(false);
  });
});
