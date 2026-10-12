import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");

import { getDatabase } from "@/lib/server/database";
import { syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { anonymizeAccount } from "@/lib/server/users/account-erasure";
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
    jest.mocked(syncSoloEntryIdentityOn).mockResolvedValue(undefined);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);

    await anonymizeAccount(fakeConnection({ execute }), 42);

    const users = execute.mock.calls
      .map(([sql]) => String(sql).replace(/\s+/g, " "))
      .find((sql) => /^ ?UPDATE bg_users SET/.test(sql) && sql.includes("is_deleted = 1"));
    expect(users).toBeDefined();
    expect(users).toMatch(/locale = 'fr'/);
  });
});
