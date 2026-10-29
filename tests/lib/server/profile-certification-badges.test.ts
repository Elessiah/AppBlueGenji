import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");

import type { Pool } from "mysql2/promise";
import { getFullProfile } from "@/lib/server/users/full-profile";
import { getDatabase } from "@/lib/server/database";
import { getPlayerEntityStats } from "@/lib/server/stats-service";
import { canSeeBattletagVerification } from "@/lib/shared/battletag-visibility";
import { emptyDeepStats } from "@/lib/shared/stats";

/**
 * Les pastilles de certification de la fiche (`/joueurs/[id]`) : tag Discord
 * certifié et BattleTag tiré d'un compte Battle.net rattaché. Toutes deux se
 * lisent par **tout** lecteur, tag masqué compris (« Masqué ✅ »), et la
 * pastille Discord ne dépend pas du chemin qui a certifié (clic sur un tag
 * nommé par Discord, ou code reçu en message privé).
 */

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    pseudo: "Player",
    avatar_url: null,
    overwatch_battletag: "Nova#1234",
    marvel_rivals_tag: null,
    discord_pseudo: "nova",
    discord_verified_at: null,
    blizzard_linked: 0,
    is_adult: 1,
    visible_avatar: 1,
    visible_overwatch: 0,
    visible_marvel: 1,
    visible_major: 1,
    visible_discord: 0,
    open_to_recruitment: 1,
    is_admin: 0,
    platform_roles_json: null,
    is_deleted: 0,
    locale: "fr",
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function profileDb(row: Record<string, unknown>) {
  const sqls: string[] = [];
  const execute = jest.fn(async (sql: string) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    sqls.push(q);
    if (q.startsWith("SELECT id, pseudo, avatar_url")) return [[row]];
    return [[]];
  });
  jest.mocked(getDatabase).mockResolvedValue({ execute } as unknown as Pool);
  return { sqls };
}

const VIEWERS: [string, { id: number; isAdmin?: boolean }][] = [
  ["un joueur quelconque", { id: 20 }],
  ["un administrateur", { id: 40, isAdmin: true }],
  ["le titulaire", { id: 7 }],
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getPlayerEntityStats).mockResolvedValue({ stats: emptyDeepStats(), tournaments: [] });
});

describe("pastille BattleTag vérifié", () => {
  it("est toujours lisible (règle partagée)", () => {
    expect(canSeeBattletagVerification()).toBe(true);
  });

  it.each(VIEWERS)("s'affiche à %s même BattleTag masqué", async (_label, viewer) => {
    profileDb(userRow({ blizzard_linked: 1 }));

    const profile = await getFullProfile(viewer, 7);

    expect(profile?.profile.battletagVerified).toBe(true);
    if (viewer.id !== 7) expect(profile?.profile.overwatchBattletag).toBeNull();
  });

  it("s'affiche aussi quand le BattleTag est visible", async () => {
    profileDb(userRow({ blizzard_linked: 1, visible_overwatch: 1 }));

    const profile = await getFullProfile({ id: 20 }, 7);

    expect(profile?.profile.battletagVerified).toBe(true);
    expect(profile?.profile.overwatchBattletag).toBe("Nova#1234");
  });

  it("ne s'affiche pas pour un BattleTag saisi à la main", async () => {
    profileDb(userRow({ blizzard_linked: 0 }));

    const profile = await getFullProfile({ id: 20 }, 7);

    expect(profile?.profile.battletagVerified).toBe(false);
  });

  it("ne s'affiche pas sur un compte Battle.net rattaché sans BattleTag", async () => {
    profileDb(userRow({ blizzard_linked: 1, overwatch_battletag: null }));

    const profile = await getFullProfile({ id: 20 }, 7);

    expect(profile?.profile.battletagVerified).toBe(false);
  });

  it("ne lit qu'un booléen : l'identifiant Blizzard ne sort jamais", async () => {
    const { sqls } = profileDb(userRow({ blizzard_linked: 1 }));

    const profile = await getFullProfile({ id: 20 }, 7);

    const select = sqls.find((sql) => sql.startsWith("SELECT id, pseudo, avatar_url")) ?? "";
    expect(select).toContain("(blizzard_sub IS NOT NULL AND overwatch_battletag_typed = 0) AS blizzard_linked");
    expect(select).not.toMatch(/blizzard_sub,/);
    expect(JSON.stringify(profile)).not.toMatch(/blizzard/i);
  });
});

describe("pastille Discord certifié", () => {
  it.each([
    ["certifié d'un clic (tag nommé par Discord)", "OAUTH"],
    ["certifié par code en message privé", "DM_CODE"],
  ])("s'affiche pour un tag %s, tag masqué compris", async (_label, method) => {
    profileDb(userRow({ discord_verified_at: new Date("2026-10-01T00:00:00Z"), discord_link_method: method }));

    const profile = await getFullProfile({ id: 20 }, 7);

    expect(profile?.profile.discordVerified).toBe(true);
    expect(profile?.profile.discordPseudo).toBeNull();
  });

  it("ne s'affiche pas pour un Discord rattaché mais non certifié", async () => {
    profileDb(userRow({ discord_verified_at: null, discord_link_method: "DM_CODE" }));

    const profile = await getFullProfile({ id: 20 }, 7);

    expect(profile?.profile.discordVerified).toBe(false);
  });
});
