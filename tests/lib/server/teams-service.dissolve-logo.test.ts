import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/stored-upload-cleanup");
jest.mock("@/lib/server/session-streams", () => ({ reconnectUserStreams: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import { softDeleteTeam } from "@/lib/server/teams/dissolution";
import { reconnectUserStreams } from "@/lib/server/session-streams";

/**
 * Dissoudre une équipe remettait `logo_url` à NULL sans effacer le fichier : le
 * logo restait servi publiquement, en cache d'un an, y compris après un
 * signalement de droit d'auteur. Le fichier part désormais après le commit.
 */
function mockDb(logoUrl: string | null, failOn?: RegExp) {
  const poolExecute = jest.fn<SqlQuery>()
    .mockResolvedValueOnce([[{ deleted_at: null }], []])
    .mockResolvedValueOnce([[{ roles_json: JSON.stringify(["OWNER"]) }], []]);
  const connectionExecute = jest.fn<SqlQuery>(async (sql: string) => {
    if (failOn?.test(sql)) throw new Error("ER_LOCK_DEADLOCK");
    if (/SELECT logo_url, deleted_at, is_ghost FROM bg_teams/.test(sql)) {
      return [[{ logo_url: logoUrl, deleted_at: null, is_ghost: 0 }], []];
    }
    if (/SELECT roles_json/.test(sql)) return [[{ roles_json: JSON.stringify(["OWNER"]) }], []];
    if (/SELECT user_id FROM bg_team_members/.test(sql)) return [[{ user_id: 12 }, { user_id: 30 }], []];
    if (/UNION\s+SELECT id FROM bg_tournaments/.test(sql)) return [[{ id: 40 }, { id: 41 }], []];
    return [{ affectedRows: 1 }, []];
  });
  const connection = {
    execute: connectionExecute,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: poolExecute, getConnection: jest.fn(async () => connection) }));
  return { connectionExecute, connection };
}

describe("softDeleteTeam — fichier du logo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(deleteUnreferencedUpload).mockResolvedValue(true);
  });

  it("relit le logo sous verrou en première instruction, puis l'efface après le commit", async () => {
    const { connectionExecute, connection } = mockDb("/api/uploads/teams/12-abc.webp");

    await softDeleteTeam(1, 12);

    expect(String(connectionExecute.mock.calls[0][0])).toMatch(
      /SELECT logo_url, deleted_at, is_ghost FROM bg_teams WHERE id = \? FOR UPDATE/,
    );
    expect(deleteUnreferencedUpload).toHaveBeenCalledWith("/api/uploads/teams/12-abc.webp", "teams");
    expect(jest.mocked(deleteUnreferencedUpload).mock.invocationCallOrder[0])
      .toBeGreaterThan(connection.commit.mock.invocationCallOrder[0]);
  });

  it("n'efface rien quand la dissolution échoue", async () => {
    mockDb("/api/uploads/teams/12-abc.webp", /SET deleted_at/);

    await expect(softDeleteTeam(1, 12)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(deleteUnreferencedUpload).not.toHaveBeenCalled();
  });

  it("rejuge la propriété sous le verrou : un transfert commité entre-temps refuse la dissolution", async () => {
    // Vieil onglet de l'ancien propriétaire : OWNER lu sur le pool, perdu
    // (transfert) avant que la dissolution n'obtienne le verrou de l'équipe.
    const { connectionExecute, connection } = mockDb("/api/uploads/teams/12-abc.webp");
    connectionExecute.mockImplementation(async (sql: string) => {
      if (/FROM bg_teams WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[{ logo_url: "/api/uploads/teams/12-abc.webp", deleted_at: null, is_ghost: 0 }], []];
      }
      if (/SELECT roles_json/.test(sql)) return [[{ roles_json: JSON.stringify(["TANK"]) }], []];
      return [{ affectedRows: 1 }, []];
    });

    await expect(softDeleteTeam(1, 12)).rejects.toThrow("FORBIDDEN");
    const roleRead = connectionExecute.mock.calls.map(([sql]) => String(sql)).find((sql) => /roles_json/.test(sql));
    expect(roleRead).toMatch(/FOR UPDATE/);
    expect(connectionExecute.mock.calls.some(([sql]) => /SET deleted_at/.test(String(sql)))).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
    expect(deleteUnreferencedUpload).not.toHaveBeenCalled();
  });

  it("refuse une équipe dissoute pendant l'attente du verrou", async () => {
    const { connectionExecute } = mockDb(null);
    connectionExecute.mockImplementation(async (sql: string) => {
      if (/FROM bg_teams WHERE id = \? FOR UPDATE/.test(sql)) {
        return [[{ logo_url: null, deleted_at: new Date(), is_ghost: 0 }], []];
      }
      return [{ affectedRows: 1 }, []];
    });

    await expect(softDeleteTeam(1, 12)).rejects.toThrow("TEAM_ALREADY_DELETED");
    expect(connectionExecute).toHaveBeenCalledTimes(1);
  });

  it("ferme les flux des membres détachés après le commit, jamais quand la dissolution échoue (EF-04)", async () => {
    const { connectionExecute, connection } = mockDb(null);
    await softDeleteTeam(1, 12);
    const select = connectionExecute.mock.calls.findIndex(([sql]) => /SELECT user_id FROM bg_team_members/.test(String(sql)));
    const detach = connectionExecute.mock.calls.findIndex(([sql]) => /UPDATE bg_team_members SET left_at = NOW\(\)/.test(String(sql)));
    expect(String(connectionExecute.mock.calls[select][0])).toMatch(/WHERE team_id = \? AND left_at IS NULL/);
    expect(select).toBeLessThan(detach);
    // Un seul passage pour tous les membres, limité aux tournois de l'équipe.
    expect(jest.mocked(reconnectUserStreams).mock.calls).toEqual([[[12, 30], { tournamentIds: new Set([40, 41]) }]]);
    expect(jest.mocked(reconnectUserStreams).mock.invocationCallOrder[0])
      .toBeGreaterThan(connection.commit.mock.invocationCallOrder[0]);

    jest.mocked(reconnectUserStreams).mockClear();
    mockDb(null, /UPDATE bg_team_members SET left_at/);
    await expect(softDeleteTeam(1, 12)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(reconnectUserStreams).not.toHaveBeenCalled();
  });

  it("délègue sans adresse quand l'équipe n'a pas de logo", async () => {
    mockDb(null);
    await softDeleteTeam(1, 12);
    expect(deleteUnreferencedUpload).toHaveBeenCalledWith(null, "teams");
  });
});
