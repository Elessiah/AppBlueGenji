import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listPlayers } from "@/lib/server/users/players";
import { clearCache } from "@/lib/server/cache";
import { type SqlQuery, type SqlMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

async function mockDb(execute: SqlMock) {
  const { getDatabase } = await import("@/lib/server/database");
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
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

/**
 * `listPlayers` enchaîne : les comptes, leur équipe courante, puis le bilan par
 * `loadAllPlayerRecords` (appartenances, matchs, inscriptions). Sans appartenance,
 * le chargeur s'arrête là — d'où trois réponses seulement.
 */
async function runList(rows: Record<string, unknown>[], viewerId: number) {
  const execute = jest
    .fn<SqlQuery>()
    .mockResolvedValueOnce([rows]) // bg_users
    .mockResolvedValueOnce([[]]) // team memberships (équipe courante)
    .mockResolvedValueOnce([[]]); // appartenances (loadAllPlayerRecords)
  await mockDb(execute);
  return listPlayers(viewerId);
}

describe("listPlayers visibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Les statistiques sont mutualisées (`stats-cache.ts`) : chaque cas relit la base.
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  // L'annuaire lit tous les comptes : une liste `IN (?, …)` de tous leurs
  // identifiants ne filtrait rien et portait un paramètre par compte (deux fois
  // dans l'union des engagements). Les deux lectures portent sur tout le site.
  it("lit appartenances et engagements sans liste d'identifiants", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[userRow({ id: 7 }), userRow({ id: 9, pseudo: "Other" })]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await listPlayers(999);

    const [current, currentParams] = execute.mock.calls[1] as [string, unknown[] | undefined];
    expect(current).not.toMatch(/\bIN \(/);
    expect(current).toMatch(/WHERE tm\.left_at IS NULL/);
    expect(currentParams ?? []).toEqual([]);

    const [union, unionParams] = execute.mock.calls[2] as [string, unknown[]];
    expect(union).not.toMatch(/\bIN \(/);
    expect(union).toMatch(/FROM bg_teams\s+WHERE solo_user_id IS NOT NULL/);
    expect(unionParams).toEqual([]);
  });

  // Le bilan de la carte ne se calcule plus ici : il descend du même chargeur
  // que la fiche, sur l'assiette partagée. Deux requêtes d'agrégation maison
  // avaient fini par contredire la fiche du même joueur.
  it("ne compte plus victoires et défaites avec sa propre requête", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[userRow({ id: 7 })]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await listPlayers(999);

    for (const call of execute.mock.calls) {
      const [sql] = call as [string];
      expect(sql).not.toMatch(/loser_team_id = tm\.team_id/);
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
    expect(players[0].games).toEqual(["OW", "MR"]);
  });
});

describe("listPlayers — comptes anonymisés", () => {
  it("rend `isDeleted`, sans quoi l'annuaire ne peut pas les masquer", async () => {
    const open = await runList([userRow()], 999);
    expect(open[0].isDeleted).toBe(false);

    const deleted = await runList([userRow({ is_deleted: 1, pseudo: "compte_supprime_7" })], 999);
    expect(deleted[0].isDeleted).toBe(true);
  });

  it("les liste tout de même : la ligne sert à qui remonte un ancien match", async () => {
    const rows = await runList(
      [userRow(), userRow({ id: 8, is_deleted: 1, pseudo: "compte_supprime_8" })],
      999,
    );
    expect(rows).toHaveLength(2);
  });
});

/**
 * Le bilan de l'annuaire recharge les matchs de toutes les équipes du site :
 * c'était la lecture la plus lourde qu'un F5 pouvait relancer. Il est mutualisé
 * — mais **pas** les lignes de compte, dont la visibilité dépend du lecteur et
 * qu'un réglage de profil doit changer sur-le-champ.
 */
describe("listPlayers — bilan mutualisé", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clearCache();
  });

  function directoryExecute(rows: Record<string, unknown>[]) {
    return jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([rows]) // bg_users
      .mockResolvedValueOnce([[]]) // équipe courante
      .mockResolvedValueOnce([[{ user_id: 7, team_id: 5, joined_at: new Date("2026-01-01T00:00:00Z"), left_at: null }]])
      .mockResolvedValueOnce([[]]) // matchs
      .mockResolvedValueOnce([[]]) // inscriptions
      .mockResolvedValueOnce([rows]) // bg_users, second appel
      .mockResolvedValueOnce([[]]); // équipe courante, second appel
  }

  it("ne recalcule pas le bilan à un second chargement", async () => {
    const execute = directoryExecute([userRow()]);
    await mockDb(execute);

    await listPlayers(999);
    await listPlayers(999);

    // 5 lectures au premier appel, 2 seulement au second : le bilan est resservi.
    expect(execute).toHaveBeenCalledTimes(7);
  });

  it("relit les comptes à chaque appel : un avatar masqué l'est aussitôt", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[userRow()]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[userRow({ visible_avatar: 0 })]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    const before = await listPlayers(999);
    const after = await listPlayers(999);

    expect(before[0].avatarUrl).toBe("/api/uploads/avatars/x.webp");
    expect(after[0].avatarUrl).toBeNull();
  });

  it("donne un bilan vide à un compte né après le calcul mis en cache", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[userRow()]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[userRow(), userRow({ id: 8, pseudo: "Neuf" })]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await listPlayers(999);
    const players = await listPlayers(999);

    const newcomer = players.find((player) => player.id === 8);
    expect(newcomer).toMatchObject({ wins: 0, losses: 0, tournamentsCount: 0 });
  });
});
