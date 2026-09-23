import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/stats-service");
jest.mock("@/lib/server/ranking-service");

import { getTeamDetail } from "@/lib/server/teams-service";
import { getDatabase } from "@/lib/server/database";
import { getTeamEntityStats } from "@/lib/server/stats-service";
import { getTeamRankingPosition } from "@/lib/server/ranking-service";
import { fakePool } from "../../helpers/sql-double";
import { emptyDeepStats } from "@/lib/shared/stats";

/**
 * `visible_avatar` sur le roster d'une **fiche** d'équipe.
 *
 * Le chemin frère (`listTeams`, carte d'annuaire) a reçu son test de
 * comportement et sa garde sur la forme de la requête ; celui-ci n'avait ni
 * l'un ni l'autre — tous les fichiers de test qui nomment `getTeamDetail`
 * moquent le module entier. Retirer la colonne du `SELECT` viderait pourtant
 * l'avatar de **tous** les rosters du site, `undefined === 1` étant faux.
 * Voir `docs/AUTHORIZATION_RULES.md` §2.3.
 */

const MEMBERS_QUERY = /FROM bg_team_members tm/;
const TEAM_QUERY = /FROM bg_teams\s+WHERE id = \?/;

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    membership_id: 1,
    user_id: 7,
    pseudo: "Nova",
    avatar_url: "/api/uploads/avatars/7.webp",
    visible_avatar: 1,
    roles_json: JSON.stringify(["OWNER"]),
    joined_at: new Date("2026-01-15T10:00:00.000Z"),
    ...overrides,
  };
}

async function mockDb(members: Record<string, unknown>[]) {
  const execute = jest.fn(async (sql: unknown) => {
    const text = String(sql);
    if (TEAM_QUERY.test(text)) {
      return [
        [
          {
            id: 12,
            name: "Test - Dragons",
            tag: "DRG",
            logo_url: null,
            description: null,
            created_at: new Date("2026-01-01T10:00:00.000Z"),
            deleted_at: null,
            is_ghost: 0,
            solo_user_id: null,
          },
        ],
        [],
      ];
    }
    if (MEMBERS_QUERY.test(text)) return [members, []];
    return [[], []];
  });

  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  jest.mocked(getTeamEntityStats).mockResolvedValue({ stats: emptyDeepStats(), tournaments: [] });
  jest.mocked(getTeamRankingPosition).mockResolvedValue({
    position: null,
    total: 0,
    points: 500,
    placementPoints: 0,
  });
  return execute;
}

const avatarOf = (detail: Awaited<ReturnType<typeof getTeamDetail>>, userId: number) =>
  detail?.members.find((member) => member.userId === userId)?.avatarUrl;

describe("getTeamDetail — avatar masqué sur le roster", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("masque l'avatar d'un membre qui l'a rendu privé", async () => {
    await mockDb([memberRow({ visible_avatar: 0 })]);

    const detail = await getTeamDetail(12, 999);

    expect(avatarOf(detail, 7)).toBeNull();
  });

  it("le laisse à son propriétaire, qui doit voir le sien", async () => {
    await mockDb([memberRow({ visible_avatar: 0 })]);

    const detail = await getTeamDetail(12, 7);

    expect(avatarOf(detail, 7)).toBe("/api/uploads/avatars/7.webp");
  });

  it("laisse passer un avatar public", async () => {
    await mockDb([memberRow({ visible_avatar: 1 })]);

    const detail = await getTeamDetail(12, 999);

    expect(avatarOf(detail, 7)).toBe("/api/uploads/avatars/7.webp");
  });

  it("ne masque que ce qui doit l'être, membre par membre", async () => {
    await mockDb([
      memberRow({ user_id: 7, pseudo: "Nova", visible_avatar: 0 }),
      memberRow({
        membership_id: 2,
        user_id: 8,
        pseudo: "Kite",
        avatar_url: "/api/uploads/avatars/8.webp",
        visible_avatar: 1,
      }),
      memberRow({
        membership_id: 3,
        user_id: 9,
        pseudo: "Rime",
        avatar_url: "/api/uploads/avatars/9.webp",
        visible_avatar: 0,
      }),
    ]);

    const detail = await getTeamDetail(12, 7);

    expect([avatarOf(detail, 7), avatarOf(detail, 8), avatarOf(detail, 9)]).toEqual([
      "/api/uploads/avatars/7.webp",
      "/api/uploads/avatars/8.webp",
      null,
    ]);
  });

  it("sélectionne `visible_avatar` dans la requête des membres", async () => {
    // Sans la colonne, le masquage retomberait sur `undefined === 1` — donc sur
    // « masqué » pour tout le monde, panne aussi silencieuse que l'inverse.
    const execute = await mockDb([memberRow()]);

    await getTeamDetail(12, 7);

    const sql = execute.mock.calls
      .map((call) => String(call[0]))
      .find((text) => MEMBERS_QUERY.test(text))!;
    expect(sql).toMatch(/u\.visible_avatar/);
  });
});
