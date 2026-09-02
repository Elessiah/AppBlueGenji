import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { listTeams } from "@/lib/server/teams-service";

jest.mock("@/lib/server/database");

/**
 * `listTeams` alimente l'annuaire `/equipes` — dont le logo de chaque équipe.
 *
 * Le bug d'affichage des logos était côté rendu (la carte n'en lisait pas le
 * champ), pas côté lecture : cette garde fixe l'autre bout du fil, pour qu'une
 * réécriture de la requête ne redevienne pas la cause du même symptôme.
 */

const TEAM_QUERY = /AS members_count/;
const RANKING_QUERY = /AS wins/;

/**
 * `listTeams` enchaîne cinq lectures : équipes, forme, classement, roster,
 * jeux. On les distingue par leur SQL plutôt que par leur rang d'appel, pour ne
 * pas casser au moindre déplacement d'une requête.
 *
 * Le bilan (victoires, défaites, points) ne sort **pas** de la requête des
 * équipes : il vient du classement du site, servi ici par la même fixture — la
 * carte d'annuaire et la fiche lisent le même nombre.
 */
async function mockDb(teamRows: Record<string, unknown>[]) {
  const execute = jest.fn(async (sql: unknown) => {
    const text = String(sql);
    if (TEAM_QUERY.test(text)) return [teamRows];
    if (RANKING_QUERY.test(text)) {
      return [
        teamRows.map((row) => ({
          team_id: row.id,
          team_name: row.name,
          logo_url: row.logo_url,
          wins: row.wins,
          losses: row.losses,
        })),
      ];
    }
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
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

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
