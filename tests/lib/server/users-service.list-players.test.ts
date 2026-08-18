import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listPlayers } from "@/lib/server/users-service";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    pseudo: "Player",
    avatar_url: "/api/uploads/avatars/x.webp",
    overwatch_battletag: "Player#1234",
    marvel_rivals_tag: "MarvelTag",
    discord_pseudo: null,
    is_adult: 1,
    visible_avatar: 1,
    visible_overwatch: 1,
    visible_marvel: 1,
    visible_major: 1,
    open_to_recruitment: 1,
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** listPlayers enchaîne 4 requêtes : users, memberships, tournois, wins/losses. */
async function runList(rows: Record<string, unknown>[], viewerId: number) {
  const execute = jest
    .fn()
    .mockResolvedValueOnce([rows]) // bg_users
    .mockResolvedValueOnce([[]]) // team memberships
    .mockResolvedValueOnce([[]]) // tournament counts
    .mockResolvedValueOnce([[]]); // wins/losses
  await mockDb(execute);
  return listPlayers(viewerId);
}

describe("listPlayers visibility", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("masks the avatar of other players when hidden", async () => {
    const players = await runList([userRow({ visible_avatar: 0 })], 999);
    expect(players[0].avatarUrl).toBeNull();
  });

  it("garde le pseudo visible même avatar masqué : il n'est plus masquable", async () => {
    const players = await runList([userRow({ visible_avatar: 0 })], 999);
    expect(players[0].pseudo).toBe("Player");
  });

  it("keeps avatar visible when the flag is set", async () => {
    const players = await runList([userRow()], 999);
    expect(players[0].pseudo).toBe("Player");
    expect(players[0].avatarUrl).toBe("/api/uploads/avatars/x.webp");
  });

  it("never masks the viewer's own entry", async () => {
    const players = await runList([userRow({ visible_avatar: 0 })], 7);
    expect(players[0].pseudo).toBe("Player");
    expect(players[0].avatarUrl).toBe("/api/uploads/avatars/x.webp");
  });

  it("expose l'ouverture au recrutement", async () => {
    const open = await runList([userRow()], 999);
    expect(open[0].openToRecruitment).toBe(true);
    const closed = await runList([userRow({ open_to_recruitment: 0 })], 999);
    expect(closed[0].openToRecruitment).toBe(false);
  });

  // Les engagements du joueur (équipes + entrée solo des tournois individuels)
  // sont une union : le filtre doit vivre DANS chaque branche, sinon la table
  // dérivée perd l'index `user_id` et fait scanner toutes les adhésions.
  it("filtre les engagements dans les deux branches de l'union", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[userRow({ id: 7 }), userRow({ id: 9, pseudo: "Other" })]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await listPlayers(999);

    for (const call of execute.mock.calls.slice(2)) {
      const [sql, params] = call as [string, unknown[]];
      expect(sql).toMatch(/FROM bg_team_members\s+WHERE user_id IN \(\?,\?\)/);
      expect(sql).toMatch(/FROM bg_teams\s+WHERE solo_user_id IN \(\?,\?\)/);
      // Une liste d'identifiants par branche.
      expect(params).toEqual([7, 9, 7, 9]);
    }
  });

  it("masks the battletag string but keeps the game badge visible", async () => {
    const players = await runList(
      [userRow({ visible_overwatch: 0, visible_marvel: 1 })],
      999,
    );
    // La chaîne exacte du tag est privée…
    expect(players[0].overwatchBattletag).toBeNull();
    // …mais le fait de jouer au jeu reste public (badges dérivés des tags bruts).
    expect(players[0].games).toEqual(["OW2", "MR"]);
  });
});
