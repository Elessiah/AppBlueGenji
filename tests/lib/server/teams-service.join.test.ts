import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { requestToJoinTeam } from "@/lib/server/teams-service";
import { getDatabase } from "@/lib/server/database";

/**
 * Ce qui ne se rejoint pas.
 *
 * Une **équipe fantôme** et une **entrée solo** occupent toutes deux une ligne
 * de `bg_teams` sans avoir le moindre membre. Une demande d'adhésion y restait
 * donc en attente à jamais — personne n'ayant qualité pour y répondre — et son
 * auteur se voyait ensuite refuser toute autre équipe par `ALREADY_REQUESTED`.
 * Une fantôme s'attribue par `POST /api/teams/[id]/claim` (staff `tournaments`),
 * une entrée solo n'est pas une équipe du tout.
 *
 * Voir `docs/AUTHORIZATION_RULES.md` §3.1 et §5.
 */

/**
 * Base factice : le joueur n'a pas d'équipe active, l'équipe visée est celle
 * qu'on décrit.
 */
async function mockJoinDb(team: Record<string, unknown> | null) {
  const execute = jest.fn(async (sql: unknown) => {
    const text = String(sql);
    // « Ce joueur a-t-il déjà une équipe ? » — non.
    if (text.includes("FROM bg_team_members")) return [[], []];
    if (text.includes("FROM bg_teams")) return [team === null ? [] : [team], []];
    return [[], []];
  });
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return execute;
}

function joinableTeam(overrides: Record<string, unknown> = {}) {
  return { id: 5, deleted_at: null, is_ghost: 0, solo_user_id: null, ...overrides };
}

const wrote = (execute: jest.Mock, fragment: string) =>
  execute.mock.calls.some(([sql]) => String(sql).includes(fragment));

describe("requestToJoinTeam — ni une fantôme ni une entrée solo", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuse une demande d'adhésion à une équipe fantôme", async () => {
    const execute = await mockJoinDb(joinableTeam({ is_ghost: 1 }));

    await expect(requestToJoinTeam(42, 5)).rejects.toThrow("TEAM_NOT_JOINABLE");
    expect(wrote(execute, "INSERT")).toBe(false);
  });

  it("refuse une demande d'adhésion à une entrée solo", async () => {
    // Elle naît avec `is_ghost = 0` : le seul contrôle du caractère fantôme ne
    // l'aurait pas écartée.
    const execute = await mockJoinDb(joinableTeam({ solo_user_id: 9 }));

    await expect(requestToJoinTeam(42, 5)).rejects.toThrow("TEAM_NOT_JOINABLE");
    expect(wrote(execute, "INSERT")).toBe(false);
  });

  it("refuse une équipe dissoute", async () => {
    await mockJoinDb(joinableTeam({ deleted_at: new Date() }));
    await expect(requestToJoinTeam(42, 5)).rejects.toThrow("TEAM_DELETED");
  });

  it("refuse une équipe inconnue", async () => {
    await mockJoinDb(null);
    await expect(requestToJoinTeam(42, 5)).rejects.toThrow("TEAM_NOT_FOUND");
  });

  it("laisse passer la demande sur une équipe réelle", async () => {
    const execute = await mockJoinDb(joinableTeam());

    await expect(requestToJoinTeam(42, 5)).resolves.toBe("REQUESTED");
    expect(wrote(execute, "INSERT INTO bg_team_invitations")).toBe(true);
  });

  it("lit bien le caractère fantôme et l'entrée solo dans sa requête", async () => {
    // Sans les colonnes, `undefined !== null` déclarerait toute équipe solo et
    // `undefined === 1` aucune fantôme : les deux pannes sont muettes.
    const execute = await mockJoinDb(joinableTeam());

    await requestToJoinTeam(42, 5);

    const sql = execute.mock.calls
      .map(([query]) => String(query))
      .find((query) => query.includes("FROM bg_teams"))!;
    expect(sql).toMatch(/is_ghost/);
    expect(sql).toMatch(/solo_user_id/);
  });
});
