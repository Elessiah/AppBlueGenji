import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listTeams } from "@/lib/server/teams-service";
import { clearCache } from "@/lib/server/cache";

jest.mock("@/lib/server/database");

/**
 * `listTeams` alimente l'annuaire `/equipes` — dont le logo de chaque équipe.
 *
 * Le bug d'affichage des logos était côté rendu (la carte n'en lisait pas le
 * champ), pas côté lecture : cette garde fixe l'autre bout du fil, pour qu'une
 * réécriture de la requête ne redevienne pas la cause du même symptôme.
 */

const TEAM_QUERY = /AS members_count/;
const IDENTITY_QUERY = /FROM bg_teams\s+WHERE solo_user_id IS NULL/;
const REPLAY_QUERY = /AS played_at/;
// `limited_members` et non `ROW_NUMBER` : la requête de forme en emploie une
// aussi, et la distinguer par sa fenêtre attraperait les deux.
const ROSTER_QUERY = /limited_members/;

/**
 * `listTeams` enchaîne plusieurs lectures : équipes, forme, classement (rejeu
 * des matchs puis identités), roster, jeux. On les distingue par leur SQL
 * plutôt que par leur rang d'appel, pour ne pas casser au moindre déplacement
 * d'une requête.
 *
 * Le bilan (victoires, défaites, cote) ne sort **pas** de la requête des
 * équipes : il vient du classement du site, rejoué ici depuis les mêmes matchs
 * — la carte d'annuaire et la fiche lisent le même nombre.
 *
 * `wins` sur une ligne d'équipe décrit ici le nombre de victoires à fabriquer
 * dans le rejeu : chacune est une rencontre gagnée contre une équipe de passage,
 * ce qui monte la cote sans polluer la liste.
 */
async function mockDb(
  teamRows: Record<string, unknown>[],
  rosterRows: Record<string, unknown>[] = [],
) {
  let matchId = 0;
  let sparringId = 10_000;
  const matches = teamRows.flatMap((row) =>
    Array.from({ length: Number(row.wins ?? 0) }, () => {
      matchId += 1;
      sparringId += 1;
      return {
        id: matchId,
        team1_id: row.id,
        team2_id: sparringId,
        winner_team_id: row.id,
        played_at: new Date(`2026-06-${String((matchId % 28) + 1).padStart(2, "0")}T18:00:00Z`),
      };
    }),
  );

  const execute = jest.fn(async (sql: unknown) => {
    const text = String(sql);
    if (TEAM_QUERY.test(text)) return [teamRows];
    if (REPLAY_QUERY.test(text)) return [matches];
    if (IDENTITY_QUERY.test(text)) {
      return [teamRows.map((row) => ({ id: row.id, name: row.name, logo_url: row.logo_url }))];
    }
    if (ROSTER_QUERY.test(text)) return [rosterRows];
    return [[]];
  });
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
  return execute;
}

function teamRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    name: "Dragon Squad",
    tag: null,
    logo_url: "/api/uploads/team-logos/12.webp",
    created_at: new Date("2026-01-15T10:00:00.000Z"),
    is_ghost: 0,
    members_count: 5,
    wins: 6,
    losses: 3,
    ...overrides,
  };
}

describe("listTeams — logo des équipes", () => {
  // Le classement est mutualisé entre appels : sans purge, un test lirait la
  // photo du précédent.
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clearCache();
  });

  it("expose le logo de l'équipe", async () => {
    await mockDb([teamRow()]);

    const teams = await listTeams();

    expect(teams).toHaveLength(1);
    expect(teams[0].logoUrl).toBe("/api/uploads/team-logos/12.webp");
  });

  it("rend `null` — et non une URL inventée — pour une équipe sans logo", async () => {
    await mockDb([teamRow({ logo_url: null })]);

    const teams = await listTeams();

    expect(teams[0].logoUrl).toBeNull();
  });

  it("garde le logo de chaque équipe à sa place après le tri par classement", async () => {
    // La dernière ligne remonte en tête (plus de points) : le logo doit la suivre.
    await mockDb([
      teamRow({ id: 1, name: "Alpha", logo_url: null, wins: 1, losses: 0 }),
      teamRow({ id: 2, name: "Beta", logo_url: "/api/uploads/team-logos/2.webp", wins: 9, losses: 0 }),
    ]);

    const teams = await listTeams();

    expect(teams.map((t) => [t.rank, t.name, t.logoUrl])).toEqual([
      [1, "Beta", "/api/uploads/team-logos/2.webp"],
      [2, "Alpha", null],
    ]);
  });

  it("sélectionne bien `logo_url` dans la requête des équipes", async () => {
    const execute = await mockDb([teamRow()]);

    await listTeams();

    const sql = execute.mock.calls.map((call) => String(call[0])).find((s) => TEAM_QUERY.test(s))!;
    expect(sql).toMatch(/t\.logo_url/);
  });
});

/** Ligne de roster telle que la rend la requête d'aperçu de `listTeams`. */
function rosterRow(overrides: Record<string, unknown> = {}) {
  return {
    team_id: 12,
    user_id: 7,
    pseudo: "Nova",
    avatar_url: "/api/uploads/avatars/7.webp",
    visible_avatar: 1,
    ...overrides,
  };
}

/**
 * `visible_avatar` vaut aussi dans la vignette d'un roster.
 *
 * La requête lisait `u.avatar_url` sans jamais consulter le réglage : un joueur
 * qui avait masqué son avatar le voyait quand même s'afficher à tout le site,
 * sur la carte de son équipe. Voir `docs/AUTHORIZATION_RULES.md` §2.3.
 */
describe("listTeams — avatar masqué dans l'aperçu du roster", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    clearCache();
  });

  it("masque l'avatar d'un joueur qui l'a rendu privé", async () => {
    await mockDb([teamRow()], [rosterRow({ visible_avatar: 0 })]);

    const teams = await listTeams();

    expect(teams[0].rosterPreview).toEqual([{ userId: 7, pseudo: "Nova", avatarUrl: null }]);
  });

  it("le laisse à son propriétaire, qui doit voir le sien", async () => {
    await mockDb([teamRow()], [rosterRow({ visible_avatar: 0 })]);

    const teams = await listTeams(7);

    expect(teams[0].rosterPreview[0].avatarUrl).toBe("/api/uploads/avatars/7.webp");
  });

  it("laisse passer un avatar public", async () => {
    await mockDb([teamRow()], [rosterRow({ visible_avatar: 1 })]);

    const teams = await listTeams();

    expect(teams[0].rosterPreview[0].avatarUrl).toBe("/api/uploads/avatars/7.webp");
  });

  it("ne masque pas l'avatar d'un tiers au lecteur, seulement le sien", async () => {
    await mockDb(
      [teamRow()],
      [
        rosterRow({ user_id: 7, pseudo: "Nova", visible_avatar: 0 }),
        rosterRow({
          user_id: 8,
          pseudo: "Kite",
          avatar_url: "/api/uploads/avatars/8.webp",
          visible_avatar: 0,
        }),
      ],
    );

    const teams = await listTeams(7);

    expect(teams[0].rosterPreview.map((member) => member.avatarUrl)).toEqual([
      "/api/uploads/avatars/7.webp",
      null,
    ]);
  });

  it("sélectionne `visible_avatar` dans la requête du roster", async () => {
    // Sans la colonne, le masquage retomberait sur `undefined === 1` — donc sur
    // « masqué » pour tout le monde, panne aussi silencieuse que l'inverse.
    const execute = await mockDb([teamRow()], [rosterRow()]);

    await listTeams();

    const sql = execute.mock.calls.map((call) => String(call[0])).find((s) => ROSTER_QUERY.test(s))!;
    expect(sql).toMatch(/u\.visible_avatar/);
  });
});
