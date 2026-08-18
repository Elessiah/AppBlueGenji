import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getFullProfile } from "@/lib/server/users-service";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    pseudo: "Player",
    avatar_url: null,
    overwatch_battletag: null,
    marvel_rivals_tag: null,
    discord_pseudo: null,
    is_adult: 1,
    visible_avatar: 1,
    visible_pseudo: 1,
    visible_overwatch: 1,
    visible_marvel: 1,
    visible_major: 1,
    is_admin: 0,
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("users-service admin management", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  describe("getFullProfile admin fields", () => {
    it("exposes the target admin status and viewer admin flag", async () => {
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[userRow({ id: 7, is_admin: 1 })]]) // user row
        .mockResolvedValueOnce([[]]) // timeline
        .mockResolvedValueOnce([[]]) // stats: appartenances (aucune)
        .mockResolvedValueOnce([[]]); // (inutilisé : le joueur n'a aucune équipe)
      await mockDb(execute);

      const profile = await getFullProfile(1, 7, true);

      expect(profile?.isAdmin).toBe(true);
      expect(profile?.viewerIsAdmin).toBe(true);
      expect(profile?.isSelf).toBe(false);
    });

    it("hides the target admin status from non-admin viewers", async () => {
      // La cible EST admin, mais le viewer ne l'est pas : on ne divulgue pas.
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[userRow({ id: 7, is_admin: 1 })]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]]);
      await mockDb(execute);

      const profile = await getFullProfile(1, 7);

      expect(profile?.isAdmin).toBe(false);
      expect(profile?.viewerIsAdmin).toBe(false);
    });

    it("exposes staff roles publicly via displayRoles, even to non-admin viewers", async () => {
      const execute = jest
        .fn()
        .mockResolvedValueOnce([
          [userRow({ id: 7, is_admin: 0, platform_roles_json: JSON.stringify(["RECRUTEUR", "ARBITRE"]) })],
        ])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]]);
      await mockDb(execute);

      const profile = await getFullProfile(1, 7);

      // Non divulgué dans le champ admin `roles`, mais public dans `displayRoles`.
      expect(profile?.roles).toEqual([]);
      expect(profile?.displayRoles).toEqual(["ARBITRE", "RECRUTEUR"]);
    });

    it("includes ADMIN in displayRoles for an admin target", async () => {
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[userRow({ id: 7, is_admin: 1 })]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]]);
      await mockDb(execute);

      const profile = await getFullProfile(1, 7);

      expect(profile?.displayRoles).toContain("ADMIN");
    });
  });
});
