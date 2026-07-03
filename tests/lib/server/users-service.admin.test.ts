import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getFullProfile, setUserAdmin } from "@/lib/server/users-service";

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

  describe("setUserAdmin", () => {
    it("grants admin rights (is_admin = 1) after checking existence", async () => {
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[{ id: 7 }]]) // existence check
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // update
      await mockDb(execute);

      await setUserAdmin(7, true);

      expect(execute).toHaveBeenCalledTimes(2);
      const [selectSql] = execute.mock.calls[0] as [string, unknown[]];
      expect(selectSql).toMatch(/SELECT id FROM bg_users/);
      expect(selectSql).toMatch(/is_deleted = 0/);
      const [updateSql, params] = execute.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toMatch(/UPDATE bg_users SET is_admin = \?/);
      expect(params).toEqual([1, 7]);
    });

    it("revokes admin rights (is_admin = 0)", async () => {
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[{ id: 7 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      await mockDb(execute);

      await setUserAdmin(7, false);

      const [, params] = execute.mock.calls[1] as [string, unknown[]];
      expect(params).toEqual([0, 7]);
    });

    it("throws USER_NOT_FOUND without updating when the user does not exist", async () => {
      const execute = jest.fn().mockResolvedValueOnce([[]]); // existence check → empty
      await mockDb(execute);

      await expect(setUserAdmin(999, true)).rejects.toThrow("USER_NOT_FOUND");
      expect(execute).toHaveBeenCalledTimes(1); // no UPDATE issued
    });

    it("still succeeds on an idempotent write (no false USER_NOT_FOUND)", async () => {
      // La cible existe mais est déjà dans l'état demandé : l'UPDATE ne change
      // aucune ligne (affectedRows = 0) — ne doit PAS lever USER_NOT_FOUND.
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[{ id: 7 }]])
        .mockResolvedValueOnce([{ affectedRows: 0 }]);
      await mockDb(execute);

      await expect(setUserAdmin(7, true)).resolves.toBeUndefined();
    });
  });

  describe("getFullProfile admin fields", () => {
    it("exposes the target admin status and viewer admin flag", async () => {
      const execute = jest
        .fn()
        .mockResolvedValueOnce([[userRow({ id: 7, is_admin: 1 })]]) // user row
        .mockResolvedValueOnce([[]]) // timeline
        .mockResolvedValueOnce([[]]) // history
        .mockResolvedValueOnce([[{}]]); // stats
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
        .mockResolvedValueOnce([[{}]]);
      await mockDb(execute);

      const profile = await getFullProfile(1, 7);

      expect(profile?.isAdmin).toBe(false);
      expect(profile?.viewerIsAdmin).toBe(false);
    });
  });
});
