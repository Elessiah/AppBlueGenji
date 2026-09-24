import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { exportOwnData } from "@/lib/server/users-service";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
}

function exportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    pseudo: "Player",
    avatar_url: "/api/uploads/avatars/x.webp",
    overwatch_battletag: "Player#1234",
    marvel_rivals_tag: null,
    discord_pseudo: "player#0001",
    discord_id: "123456789",
    google_sub: null,
    is_adult: 1,
    is_admin: 0,
    visible_avatar: 0,
    visible_overwatch: 0,
    visible_marvel: 0,
    visible_major: 0,
    visible_discord: 1,
    open_to_recruitment: 1,
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// getFullProfile (appelé en interne) réutilise une ligne bg_users au même format.
function fullProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    pseudo: "Player",
    avatar_url: "/api/uploads/avatars/x.webp",
    overwatch_battletag: "Player#1234",
    marvel_rivals_tag: null,
    discord_pseudo: "player#0001",
    is_adult: 1,
    visible_avatar: 0,
    visible_overwatch: 0,
    visible_marvel: 0,
    visible_major: 0,
    visible_discord: 1,
    open_to_recruitment: 1,
    is_admin: 0,
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("exportOwnData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("includes raw account identifiers reserved to the owner (discord, google, blizzard)", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[exportRow()]]) // identifiants bruts
      .mockResolvedValueOnce([[fullProfileRow()]]) // getFullProfile: user row
      .mockResolvedValueOnce([[]]) // timeline
      .mockResolvedValueOnce([[]]) // stats: appartenances (aucune)
      .mockResolvedValueOnce([[]]); // (inutilisé : le joueur n'a aucune équipe)
    await mockDb(execute);

    const data = await exportOwnData(42);

    expect(data.account).toMatchObject({
      id: 42,
      discordId: "123456789",
      googleSub: null,
      isAdmin: false,
    });
    expect(data.profile.overwatchBattletag).toBe("Player#1234");
    // Le pseudo n'est plus un réglage de visibilité ; l'ouverture au
    // recrutement, elle, fait partie des données exportées.
    expect(data.profile.visibility).toEqual({
      avatar: false,
      overwatch: false,
      marvel: false,
      major: false,
      // Le réglage exporté est la valeur brute, choix du joueur compris.
      discord: true,
    });
    expect(data.profile.openToRecruitment).toBe(true);
    expect(data.exportedAt).toEqual(expect.any(String));
    // La requête d'identité exclut les comptes supprimés.
    const [selectSql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(selectSql).toMatch(/is_deleted = 0/);
    expect(params).toEqual([42]);
  });

  it("exporte le pseudo tel quel, tous réglages coupés", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[exportRow({ visible_avatar: 0, open_to_recruitment: 0 })]])
      .mockResolvedValueOnce([[fullProfileRow({ visible_avatar: 0, open_to_recruitment: 0 })]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const data = await exportOwnData(42);
    expect(data.account.pseudo).toBe("Player");
  });

  it("throws PROFILE_NOT_FOUND when the account does not exist or is deleted", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(exportOwnData(999)).rejects.toThrow("PROFILE_NOT_FOUND");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("exportOwnData — plus aucune adresse", () => {
  it("n'expose aucun champ `email` : la colonne n'existe plus", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[exportRow()]])
      .mockResolvedValueOnce([[fullProfileRow()]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const data = await exportOwnData(42);

    expect(Object.keys(data.account)).not.toContain("email");
  });

  it("ne la demande pas non plus en base", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[exportRow()]])
      .mockResolvedValueOnce([[fullProfileRow()]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await exportOwnData(42);

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).not.toContain("email");
  });
});
