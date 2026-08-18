import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { claimGhostTeam, createGhostTeam, listGhostTeams } from "@/lib/server/ghost-teams-service";

jest.mock("@/lib/server/database");

type ExecuteMock = jest.Mock;

async function mockDb(execute: ExecuteMock, connectionExecute?: ExecuteMock) {
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

describe("createGhostTeam", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("insère une équipe marquée fantôme, sans aucun membre", async () => {
    const execute = jest.fn().mockResolvedValue([{ insertId: 42 }]);
    await mockDb(execute);

    await expect(createGhostTeam("  Les Fantômes  ", "  Équipe invitée  ")).resolves.toBe(42);

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO bg_teams .*is_ghost/s);
    expect(sql).toMatch(/VALUES \(\?, NULL, \?, 1\)/);
    // Nom et description sont trimés.
    expect(params).toEqual(["Les Fantômes", "Équipe invitée"]);
  });

  it("normalise une description vide en NULL", async () => {
    const execute = jest.fn().mockResolvedValue([{ insertId: 7 }]);
    await mockDb(execute);

    await createGhostTeam("Alpha Squad", "   ");

    const [, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(["Alpha Squad", null]);
  });

  it.each(["ab", "  a  ", "x".repeat(61)])("refuse un nom invalide (%s)", async (name) => {
    const execute = jest.fn();
    await mockDb(execute);

    await expect(createGhostTeam(name)).rejects.toThrow("INVALID_TEAM_NAME");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("claimGhostTeam", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("nomme le joueur OWNER et lève le drapeau fantôme", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ is_ghost: 1, deleted_at: null }]]) // équipe
      .mockResolvedValueOnce([[{ id: 9 }]]) // utilisateur
      .mockResolvedValueOnce([[]]); // aucune équipe active
    const connectionExecute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const connection = await mockDb(execute, connectionExecute);

    await claimGhostTeam(3, 9);

    const [memberSql, memberParams] = connectionExecute.mock.calls[0] as [string, unknown[]];
    expect(memberSql).toMatch(/INSERT INTO bg_team_members/);
    expect(memberParams).toEqual([3, 9, JSON.stringify(["OWNER"])]);

    const [teamSql, teamParams] = connectionExecute.mock.calls[1] as [string, unknown[]];
    expect(teamSql).toMatch(/UPDATE bg_teams SET is_ghost = 0/);
    expect(teamParams).toEqual([3]);

    expect(connection.commit).toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("refuse une équipe inconnue", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(claimGhostTeam(3, 9)).rejects.toThrow("TEAM_NOT_FOUND");
  });

  it("refuse une équipe réelle", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[{ is_ghost: 0, deleted_at: null }]]);
    await mockDb(execute);

    await expect(claimGhostTeam(3, 9)).rejects.toThrow("NOT_A_GHOST_TEAM");
  });

  it("refuse une équipe dissoute", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[{ is_ghost: 1, deleted_at: new Date() }]]);
    await mockDb(execute);

    await expect(claimGhostTeam(3, 9)).rejects.toThrow("TEAM_ALREADY_DELETED");
  });

  it("refuse un joueur inconnu ou anonymisé", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ is_ghost: 1, deleted_at: null }]])
      .mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(claimGhostTeam(3, 9)).rejects.toThrow("USER_NOT_FOUND");
  });

  it("refuse un joueur déjà engagé dans une équipe", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ is_ghost: 1, deleted_at: null }]])
      .mockResolvedValueOnce([[{ id: 9 }]])
      .mockResolvedValueOnce([[{ id: 55 }]]);
    await mockDb(execute);

    await expect(claimGhostTeam(3, 9)).rejects.toThrow("USER_ALREADY_IN_TEAM");
  });

  it("annule la transaction si l'insertion du membre échoue", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([[{ is_ghost: 1, deleted_at: null }]])
      .mockResolvedValueOnce([[{ id: 9 }]])
      .mockResolvedValueOnce([[]]);
    const connectionExecute = jest.fn().mockRejectedValue(new Error("DB_DOWN"));
    const connection = await mockDb(execute, connectionExecute);

    await expect(claimGhostTeam(3, 9)).rejects.toThrow("DB_DOWN");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });
});

describe("listGhostTeams", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("ne renvoie que les fantômes encore actives", async () => {
    const execute = jest
      .fn()
      .mockResolvedValue([[{ id: 1, name: "Alpha", logo_url: null }, { id: 2, name: "Beta", logo_url: "/a.webp" }]]);
    await mockDb(execute);

    await expect(listGhostTeams()).resolves.toEqual([
      { id: 1, name: "Alpha", logoUrl: null },
      { id: 2, name: "Beta", logoUrl: "/a.webp" },
    ]);

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toMatch(/WHERE is_ghost = 1 AND deleted_at IS NULL/);
  });
});
