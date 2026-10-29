import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");

import { getDatabase } from "@/lib/server/database";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { anonymizeAccount } from "@/lib/server/users/account-erasure";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";
import { getFullProfile } from "@/lib/server/users/full-profile";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

/**
 * Langue du compte (lot 9-3) dans la vie du compte : lue par son seul
 * titulaire, remise au défaut à l'anonymisation. L'export est couvert par
 * `users-service.export.test.ts`.
 */

const USER_ROW = {
  id: 42,
  pseudo: "Player",
  avatar_url: null,
  overwatch_battletag: null,
  marvel_rivals_tag: null,
  discord_pseudo: null,
  discord_verified_at: null,
  is_adult: null,
  visible_avatar: 0,
  visible_overwatch: 0,
  visible_marvel: 0,
  visible_major: 0,
  visible_discord: 0,
  open_to_recruitment: 0,
  is_admin: 0,
  platform_roles_json: null,
  is_deleted: 0,
  locale: "en",
  created_at: new Date("2026-01-01T00:00:00Z"),
};

describe("langue du compte — lecture", () => {
  const load = async (viewerId: number) => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[USER_ROW], []]).mockResolvedValue([[], []]);
    const query = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, query }));
    const profile = await getFullProfile({ id: viewerId }, 42);
    expect(String(execute.mock.calls[0][0])).toMatch(/\blocale\b/);
    return profile;
  };

  it("est rendue à son titulaire", async () => {
    expect((await load(42))?.accountLocale).toBe("en");
  });

  it("n'est jamais rendue sur la fiche d'un autre", async () => {
    const profile = await load(7);
    expect(profile).not.toBeNull();
    expect(profile).not.toHaveProperty("accountLocale");
  });
});

describe("langue du compte — anonymisation", () => {
  it("revient au français", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await anonymizeAccount(fakeConnection({ execute }), 42);

    const users = execute.mock.calls
      .map(([sql]) => String(sql).replace(/\s+/g, " "))
      .find((sql) => /^ ?UPDATE bg_users SET/.test(sql) && sql.includes("is_deleted = 1"));
    expect(users).toBeDefined();
    expect(users).toMatch(/locale = \?/);
    const call = execute.mock.calls.find(([sql]) => String(sql).includes("is_deleted = 1"));
    expect(call?.[1]).toEqual([expect.any(String), DEFAULT_LOCALE, 42]);
  });
});

describe("messages privés de match — anonymisation", () => {
  it("remet le choix au défaut par une instruction à part, sur la ligne supprimée", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
    await anonymizeAccount(fakeConnection({ execute }), 42);
    const reset = execute.mock.calls.find(([sql]) => String(sql).includes("match_dm_enabled"));
    expect(reset).toEqual(["UPDATE bg_users SET match_dm_enabled = 1 WHERE id = ? AND is_deleted = 1", [42]]);
  });

  it("n'empêche pas l'effacement quand la colonne manque (migration en échec)", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const missing = Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.includes("match_dm_enabled")) throw missing;
      return [[], []];
    });
    await expect(anonymizeAccount(fakeConnection({ execute }), 42)).resolves.not.toThrow();
  });

  it("laisse passer toute autre erreur", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.includes("match_dm_enabled")) throw Object.assign(new Error("lock"), { code: "ER_LOCK_WAIT_TIMEOUT" });
      return [[], []];
    });
    await expect(anonymizeAccount(fakeConnection({ execute }), 42)).rejects.toThrow("lock");
  });
});

describe("« Ne plus afficher » du recrutement — anonymisation", () => {
  it("remet le choix au défaut par une instruction à part, sur la ligne supprimée", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
    await anonymizeAccount(fakeConnection({ execute }), 42);
    const reset = execute.mock.calls.find(([sql]) => String(sql).includes("recruitment_modal_off"));
    expect(reset).toEqual(["UPDATE bg_users SET recruitment_modal_off = 0 WHERE id = ? AND is_deleted = 1", [42]]);
  });

  it("n'empêche pas l'effacement quand la colonne manque (migration en échec)", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const missing = Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.includes("recruitment_modal_off")) throw missing;
      return [[], []];
    });
    await expect(anonymizeAccount(fakeConnection({ execute }), 42)).resolves.not.toThrow();
  });
});

describe("langue du compte — défaut de la colonne", () => {
  // L'anonymisation et accountLocaleFromRow écrivent DEFAULT_LOCALE : la
  // colonne (base neuve et base existante) doit avoir le même défaut.
  it("vaut DEFAULT_LOCALE dans le CREATE TABLE et dans l'ALTER", () => {
    const root = path.resolve(__dirname, "../../..");
    for (const file of ["lib/server/database/schema/accounts.ts", "lib/server/database/recent-schema-changes.ts"]) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source).toContain(`locale ENUM('fr', 'en') NOT NULL DEFAULT '${DEFAULT_LOCALE}'`);
    }
  });
});

describe("« Ne plus voir » de la certification Discord — anonymisation", () => {
  const isReset = (sql: unknown) => String(sql).includes("discord_certify_prompt_dismissed_at");

  it("efface le choix par une instruction à part, sur la ligne supprimée", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
    await anonymizeAccount(fakeConnection({ execute }), 42);
    const reset = execute.mock.calls.find(([sql]) => isReset(sql));
    expect(reset && [String(reset[0]).replace(/\s+/g, " ").trim(), reset[1]]).toEqual([
      "UPDATE bg_users SET discord_certify_prompt_dismissed_at = NULL WHERE id = ? AND is_deleted = 1",
      [42],
    ]);
  });

  it("n'empêche pas l'effacement quand la colonne manque (migration en échec)", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const missing = Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (isReset(sql)) throw missing;
      return [[], []];
    });
    await expect(anonymizeAccount(fakeConnection({ execute }), 42)).resolves.not.toThrow();
  });

  it("laisse passer toute autre erreur", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (isReset(sql)) throw Object.assign(new Error("lock"), { code: "ER_LOCK_WAIT_TIMEOUT" });
      return [[], []];
    });
    await expect(anonymizeAccount(fakeConnection({ execute }), 42)).rejects.toThrow("lock");
  });
});

describe("« Ne plus voir » de l'invitation à certifier de la fiche tournoi — anonymisation (EF-04)", () => {
  const isReset = (sql: unknown) => String(sql).includes("certification_prompt_dismissed_at") && !String(sql).includes("discord_certify");

  it("efface le choix par une instruction à part, sur la ligne supprimée", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
    await anonymizeAccount(fakeConnection({ execute }), 42);
    const reset = execute.mock.calls.find(([sql]) => isReset(sql));
    expect(reset && [String(reset[0]).replace(/\s+/g, " ").trim(), reset[1]]).toEqual([
      "UPDATE bg_users SET certification_prompt_dismissed_at = NULL WHERE id = ? AND is_deleted = 1",
      [42],
    ]);
  });

  it("n'empêche pas l'effacement quand la colonne manque (migration en échec)", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const missing = Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (isReset(sql)) throw missing;
      return [[], []];
    });
    await expect(anonymizeAccount(fakeConnection({ execute }), 42)).resolves.not.toThrow();
  });

  it("laisse passer toute autre erreur", async () => {
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(true);
    const execute = jest.fn<SqlQuery>(async (sql) => {
      if (isReset(sql)) throw Object.assign(new Error("lock"), { code: "ER_LOCK_WAIT_TIMEOUT" });
      return [[], []];
    });
    await expect(anonymizeAccount(fakeConnection({ execute }), 42)).rejects.toThrow("lock");
  });
});
