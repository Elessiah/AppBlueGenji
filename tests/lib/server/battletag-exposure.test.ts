import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");

import type { Pool } from "mysql2/promise";
import { getFullProfile } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";
import { getPlayerEntityStats } from "@/lib/server/stats-service";

/**
 * Ce qui sort d'une fiche quand le BattleTag est **masqué** : le lecteur
 * quelconque n'a rien, les joueurs d'un même match et l'arbitrage d'un tournoi
 * vivant ont le tag — ce que la modale de `/profil` promet au joueur qui le
 * masque. Les questions de tournoi ne sont posées que quand elles peuvent
 * changer la réponse.
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
  (getPlayerEntityStats as jest.Mock).mockResolvedValue({ stats: {}, tournaments: [] } as never);
});

describe("getFullProfile — BattleTag masqué", () => {
  it("le cache à un joueur qui ne partage aucun match avec le titulaire", async () => {
    profileDb(userRow());

    const profile = await getFullProfile({ id: 20 }, 7);

    expect(profile?.profile.overwatchBattletag).toBeNull();
  });

  it("le rend à un joueur engagé dans un même match de tournoi vivant", async () => {
    const { queries } = profileDb(userRow(), { sharesMatch: true });

    const profile = await getFullProfile({ id: 20 }, 7);

    expect(profile?.profile.overwatchBattletag).toBe("Nova#1234");
    // Le titulaire d'abord, le lecteur ensuite : la requête part des engagés du
    // titulaire, et deux paramètres par sous-requête (équipe, entrée solo).
    const match = queries.find((q) => q.sql.includes(MATCH_QUERY));
    expect(match?.params).toEqual([7, 7, 20, 20]);
    expect(match?.sql).toContain("t.state <> 'FINISHED'");
    expect(match?.sql).toContain("tm.left_at IS NULL");
    expect(match?.sql).toContain("te.solo_user_id = ?");
    // Une branche par côté du match : une jointure en `OR` n'utilise aucun
    // index et balaie `bg_matches` en entier.
    expect(match?.sql).toContain("JOIN bg_matches m ON m.team1_id = mine.team_id");
    expect(match?.sql).toContain("JOIN bg_matches m ON m.team2_id = mine.team_id");
    expect(match?.sql).not.toMatch(/ON m\.team1_id = \w+\.team_id OR/);
  });

  it("ne pose pas la question du tournoi à un joueur ordinaire", async () => {
    const { queries } = profileDb(userRow(), { inTournament: true });

    const profile = await getFullProfile({ id: 20 }, 7);

    expect(profile?.profile.overwatchBattletag).toBeNull();
    expect(count(queries, TOURNAMENT_QUERY)).toBe(0);
  });

  it("le rend à l'arbitrage quand le titulaire est engagé dans un tournoi vivant", async () => {
    profileDb(userRow(), { inTournament: true });

    const profile = await getFullProfile({ id: 30, roles: ["ARBITRE"] }, 7);

    expect(profile?.profile.overwatchBattletag).toBe("Nova#1234");
  });

  it("le cache à l'arbitrage hors tournoi vivant", async () => {
    profileDb(userRow(), { inTournament: false });

    const profile = await getFullProfile({ id: 30, roles: ["ARBITRE"] }, 7);

    expect(profile?.profile.overwatchBattletag).toBeNull();
  });

  it("le cache à un administrateur hors tournoi : aucun passe-droit", async () => {
    profileDb(userRow(), { inTournament: false });

    const profile = await getFullProfile({ id: 40, isAdmin: true }, 7);

    expect(profile?.profile.overwatchBattletag).toBeNull();
  });

  it("pose ensemble les deux questions pour l'arbitrage, chacune une fois", async () => {
    // Indépendantes : les enchaîner doublerait l'attente sur chaque fiche.
    const { queries } = profileDb(userRow(), { sharesMatch: true, inTournament: false });

    const profile = await getFullProfile({ id: 30, roles: ["ARBITRE"] }, 7);

    expect(profile?.profile.overwatchBattletag).toBe("Nova#1234");
    expect(count(queries, MATCH_QUERY)).toBe(1);
    expect(count(queries, TOURNAMENT_QUERY)).toBe(1);
  });

  it("pose la question du tournoi une seule fois, partagée avec le tag Discord", async () => {
    const { queries } = profileDb(
      userRow({ discord_pseudo: "keryan", discord_verified_at: new Date("2026-09-01T00:00:00Z") }),
      { inTournament: true },
    );

    const profile = await getFullProfile({ id: 30, roles: ["ARBITRE"] }, 7);

    expect(profile?.profile.discordPseudo).toBe("keryan");
    expect(profile?.profile.overwatchBattletag).toBe("Nova#1234");
    expect(count(queries, TOURNAMENT_QUERY)).toBe(1);
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

  it("n'ouvre pas les autres champs masqués au joueur d'un même match", async () => {
    profileDb(userRow({ marvel_rivals_tag: "Nova", visible_marvel: 0, visible_major: 0 }), {
      sharesMatch: true,
    });

    const profile = await getFullProfile({ id: 20 }, 7);

    expect(profile?.profile.overwatchBattletag).toBe("Nova#1234");
    expect(profile?.profile.marvelRivalsTag).toBeNull();
    expect(profile?.profile.isAdult).toBeNull();
  });
});
