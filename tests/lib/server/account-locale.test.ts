import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  accountLocaleForDiscordId,
  accountLocaleFromRow,
  recordAccountLocale,
  recordLoginLocale,
} from "@/lib/server/users/account-locale";
import type { Locale } from "@/lib/shared/locales";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/** Langue du compte (`bg_users.locale`, lot 9-3). */

function mockExecute(affectedRows: number) {
  const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows }, []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("recordAccountLocale", () => {
  it("écrit la langue en une instruction, sur un compte vivant seulement", async () => {
    const execute = mockExecute(1);
    expect(await recordAccountLocale(7, "en")).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/UPDATE bg_users SET locale = \? WHERE id = \? AND is_deleted = 0/);
    expect(params).toEqual(["en", 7]);
  });

  it("rend false quand aucune ligne vivante ne correspond", async () => {
    mockExecute(0);
    expect(await recordAccountLocale(7, "fr")).toBe(false);
  });

  it("n'écrit rien pour un identifiant ou une langue invalides", async () => {
    const execute = mockExecute(1);
    expect(await recordAccountLocale(0, "fr")).toBe(false);
    expect(await recordAccountLocale(-3, "fr")).toBe(false);
    expect(await recordAccountLocale(1.5, "fr")).toBe(false);
    expect(await recordAccountLocale(7, "de" as Locale)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("recordLoginLocale", () => {
  it("enregistre la langue de la page de connexion", async () => {
    const execute = mockExecute(1);
    await recordLoginLocale(4, "en");
    expect(execute.mock.calls[0][1]).toEqual(["en", 4]);
  });

  it("ne fait jamais échouer la connexion", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getDatabase).mockResolvedValue(
      fakePool({ execute: jest.fn<SqlQuery>().mockRejectedValue(Object.assign(new Error("x"), { code: "ER_BAD_FIELD_ERROR" })) }),
    );
    await expect(recordLoginLocale(4, "en")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("accountLocaleFromRow", () => {
  it("garde une langue connue et ramène tout le reste au français", () => {
    expect(accountLocaleFromRow("en")).toBe("en");
    expect(accountLocaleFromRow("fr")).toBe("fr");
    for (const value of [null, undefined, "", "EN", "de", 1]) expect(accountLocaleFromRow(value)).toBe("fr");
  });
});

describe("accountLocaleForDiscordId", () => {
  function mockQuery(rows: unknown[]) {
    const query = jest.fn<SqlQuery>().mockResolvedValue([rows, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));
    return query;
  }

  it("rend la langue du compte vivant rattaché à ce Discord", async () => {
    const query = mockQuery([{ locale: "en" }]);
    expect(await accountLocaleForDiscordId("900000000000000002")).toBe("en");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE discord_id = \? AND is_deleted = 0/);
    expect(params).toEqual(["900000000000000002"]);
  });

  it("rend null sans compte rattaché : le message part bilingue", async () => {
    mockQuery([]);
    expect(await accountLocaleForDiscordId("900000000000000002")).toBeNull();
  });

  it("rend null sur une lecture ratée, sans écrire la requête ni l'identifiant au journal", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new Error("Unknown column 'locale'"), {
      code: "ER_BAD_FIELD_ERROR",
      sql: "SELECT locale FROM bg_users WHERE discord_id = '900000000000000002'",
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query: jest.fn<SqlQuery>().mockRejectedValue(failure) }));
    expect(await accountLocaleForDiscordId("900000000000000002")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([expect.any(String), "ER_BAD_FIELD_ERROR"]);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("900000000000000002");
    spy.mockRestore();
  });
});
