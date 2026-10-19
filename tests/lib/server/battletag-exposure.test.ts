import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");

import type { Pool } from "mysql2/promise";
import { getFullProfile } from "@/lib/server/users/full-profile";
import { getDatabase } from "@/lib/server/database";
import { getPlayerEntityStats } from "@/lib/server/stats-service";
import { emptyDeepStats } from "@/lib/shared/stats";

/**
 * Ce qui sort d'une fiche quand le BattleTag est **masqué** : rien, pour
 * personne d'autre que son titulaire — adversaires, arbitres et administrateurs
 * compris, même pendant un tournoi vivant. Un BattleTag masqué ne se lit que
 * dans la fenêtre « Contacts » d'un match (décision de l'utilisateur du
 * 2026-10-19), et la fiche ne pose plus aucune question de match pour lui.
 */

type Query = { sql: string; params: unknown[] };

const MATCH_QUERY = "JOIN bg_matches m";
const TOURNAMENT_QUERY = "FROM bg_tournament_registrations r";

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    pseudo: "Player",
    avatar_url: null,
    overwatch_battletag: "Nova#1234",
    marvel_rivals_tag: null,
    discord_pseudo: null,
    discord_verified_at: null,
    is_adult: 1,
    visible_avatar: 1,
    visible_overwatch: 0,
    visible_marvel: 1,
    visible_major: 1,
    open_to_recruitment: 1,
    is_admin: 0,
    platform_roles_json: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function profileDb(
  row: Record<string, unknown>,
  facts: { sharesMatch?: boolean; inTournament?: boolean } = {},
) {
  const queries: Query[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    if (q.startsWith("SELECT id, pseudo, avatar_url")) return [[row]];
    if (q.includes(MATCH_QUERY)) return [facts.sharesMatch ? [{ c: 1 }] : []];
    if (q.includes(TOURNAMENT_QUERY)) return [facts.inTournament ? [{ c: 1 }] : []];
    return [[]];
  });
  jest.mocked(getDatabase).mockResolvedValue({ execute } as unknown as Pool);
  return { queries };
}

const count = (queries: Query[], needle: string) =>
  queries.filter((q) => q.sql.includes(needle)).length;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getPlayerEntityStats).mockResolvedValue({ stats: emptyDeepStats(), tournaments: [] });
});

describe("getFullProfile — BattleTag masqué", () => {
  it.each<[string, { id: number; isAdmin?: boolean; roles?: ("ARBITRE")[] }]>([
    ["joueur d'un même match", { id: 20 }],
    ["arbitre", { id: 30, roles: ["ARBITRE"] }],
    ["administrateur", { id: 40, isAdmin: true }],
  ])("le cache sur la fiche au lecteur %s, même pendant un tournoi vivant", async (_label, viewer) => {
    const { queries } = profileDb(userRow(), { sharesMatch: true, inTournament: true });

    const profile = await getFullProfile(viewer, 7);

    expect(profile?.profile.overwatchBattletag).toBeNull();
    expect(count(queries, MATCH_QUERY)).toBe(0);
  });
});

describe("getFullProfile — quand la réponse est acquise, aucune requête", () => {
  it("rend le tag masqué à son titulaire", async () => {
    const { queries } = profileDb(userRow());

    const profile = await getFullProfile({ id: 7 }, 7);

    expect(profile?.profile.overwatchBattletag).toBe("Nova#1234");
    expect(count(queries, MATCH_QUERY)).toBe(0);
  });

  it("rend un tag visible à tout lecteur", async () => {
    const { queries } = profileDb(userRow({ visible_overwatch: 1 }));

    const profile = await getFullProfile({ id: 20 }, 7);

    expect(profile?.profile.overwatchBattletag).toBe("Nova#1234");
    expect(count(queries, MATCH_QUERY)).toBe(0);
  });

  it("ne demande rien quand le titulaire n'a pas de BattleTag", async () => {
    const { queries } = profileDb(userRow({ overwatch_battletag: null }));

    const profile = await getFullProfile({ id: 30, roles: ["ARBITRE"] }, 7);

    expect(profile?.profile.overwatchBattletag).toBeNull();
    expect(count(queries, MATCH_QUERY)).toBe(0);
    expect(count(queries, TOURNAMENT_QUERY)).toBe(0);
  });
});
