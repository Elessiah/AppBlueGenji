import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/stored-upload-cleanup");

import { getDatabase } from "@/lib/server/database";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import { softDeleteTeam } from "@/lib/server/teams-service";

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
    if (/SELECT logo_url FROM bg_teams/.test(sql)) return [[{ logo_url: logoUrl }], []];
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

    expect(String(connectionExecute.mock.calls[0][0])).toMatch(/SELECT logo_url FROM bg_teams WHERE id = \? FOR UPDATE/);
    expect(deleteUnreferencedUpload).toHaveBeenCalledWith("/api/uploads/teams/12-abc.webp", "teams");
    expect(jest.mocked(deleteUnreferencedUpload).mock.invocationCallOrder[0])
      .toBeGreaterThan(connection.commit.mock.invocationCallOrder[0]);
  });

  it("n'efface rien quand la dissolution échoue", async () => {
    mockDb("/api/uploads/teams/12-abc.webp", /SET deleted_at/);

    await expect(softDeleteTeam(1, 12)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(deleteUnreferencedUpload).not.toHaveBeenCalled();
  });

  it("délègue sans adresse quand l'équipe n'a pas de logo", async () => {
    mockDb(null);
    await softDeleteTeam(1, 12);
    expect(deleteUnreferencedUpload).toHaveBeenCalledWith(null, "teams");
  });
});
