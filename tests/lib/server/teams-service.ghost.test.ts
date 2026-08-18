import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { isGhostTeam, softDeleteTeam, updateTeamLogo, updateTeamMeta } from "@/lib/server/teams-service";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock, connectionExecute?: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  const connection = {
    execute: connectionExecute ?? execute,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  (getDatabase as jest.Mock).mockResolvedValue({
    execute,
    getConnection: jest.fn(async () => connection),
  });
  return connection;
}

/** Le viewer n'est membre d'aucune équipe : `roles_json` introuvable. */
const NOT_A_MEMBER = [[]];

describe("isGhostTeam", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [{ is_ghost: 1, deleted_at: null }, true],
    [{ is_ghost: 0, deleted_at: null }, false],
    // Une fantôme dissoute n'est plus administrable.
    [{ is_ghost: 1, deleted_at: new Date() }, false],
  ])("%p → %s", async (row, expected) => {
    const execute = jest.fn().mockResolvedValue([[row]]);
    await mockDb(execute);

    await expect(isGhostTeam(3)).resolves.toBe(expected);
  });

  it("renvoie false pour une équipe inconnue", async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    await mockDb(execute);

    await expect(isGhostTeam(3)).resolves.toBe(false);
  });
});

describe("updateTeamMeta — dérogation staff sur les équipes fantômes", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("autorise un non-membre avec la permission tournois sur une fantôme", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(NOT_A_MEMBER) // userOwnsTeam
      .mockResolvedValueOnce([[{ is_ghost: 1, deleted_at: null }]]) // isGhostTeam
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE
    await mockDb(execute);

    await updateTeamMeta(99, 3, { name: "Nouveau nom" }, true);

    const [sql, params] = execute.mock.calls[2] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE bg_teams SET name = \?/);
    expect(params).toEqual(["Nouveau nom", 3]);
  });

  it("refuse le même staff sur une équipe réelle", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(NOT_A_MEMBER)
      .mockResolvedValueOnce([[{ is_ghost: 0, deleted_at: null }]]);
    await mockDb(execute);

    await expect(updateTeamMeta(99, 3, { name: "Pirate" }, true)).rejects.toThrow("FORBIDDEN");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("refuse un non-membre sans la permission, même sur une fantôme", async () => {
    const execute = jest.fn().mockResolvedValueOnce(NOT_A_MEMBER);
    await mockDb(execute);

    await expect(updateTeamMeta(99, 3, { name: "Pirate" }, false)).rejects.toThrow("FORBIDDEN");
    // Sans permission, on ne va même pas interroger le drapeau fantôme.
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("updateTeamLogo — dérogation staff", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("autorise le staff sur une fantôme", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(NOT_A_MEMBER) // getMemberRoles
      .mockResolvedValueOnce([[{ is_ghost: 1, deleted_at: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockDb(execute);

    await updateTeamLogo(99, 3, "/api/uploads/teams/x.webp", true);

    const [sql, params] = execute.mock.calls[2] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE bg_teams SET logo_url = \?/);
    expect(params).toEqual(["/api/uploads/teams/x.webp", 3]);
  });

  it("refuse le staff sur une équipe réelle", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(NOT_A_MEMBER)
      .mockResolvedValueOnce([[{ is_ghost: 0, deleted_at: null }]]);
    await mockDb(execute);

    await expect(updateTeamLogo(99, 3, null, true)).rejects.toThrow("FORBIDDEN");
  });
});

describe("softDeleteTeam — dérogation staff", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("laisse le staff supprimer une fantôme", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ deleted_at: null }]]) // teamIsDeleted
      .mockResolvedValueOnce(NOT_A_MEMBER) // userOwnsTeam
      .mockResolvedValueOnce([[{ is_ghost: 1, deleted_at: null }]]); // isGhostTeam
    const connectionExecute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const connection = await mockDb(execute, connectionExecute);

    await softDeleteTeam(99, 3, true);

    expect(connectionExecute.mock.calls[0][0]).toMatch(/UPDATE bg_teams\s+SET deleted_at = NOW\(\)/);
    expect(connection.commit).toHaveBeenCalled();
  });

  it("refuse le staff sur une équipe réelle", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ deleted_at: null }]])
      .mockResolvedValueOnce(NOT_A_MEMBER)
      .mockResolvedValueOnce([[{ is_ghost: 0, deleted_at: null }]]);
    await mockDb(execute);

    await expect(softDeleteTeam(99, 3, true)).rejects.toThrow("FORBIDDEN");
  });

  it("refuse une équipe déjà dissoute avant tout contrôle de droits", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[{ deleted_at: new Date() }]]);
    await mockDb(execute);

    await expect(softDeleteTeam(99, 3, true)).rejects.toThrow("TEAM_ALREADY_DELETED");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
