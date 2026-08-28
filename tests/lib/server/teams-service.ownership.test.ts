import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { transferTeamOwnership } from "@/lib/server/teams-service";

jest.mock("@/lib/server/database");

type ExecuteMock = jest.Mock;

/**
 * `transferTeamOwnership` lit deux fois les rôles (demandeur puis cible) via le
 * pool, puis écrit les deux lignes dans une transaction. Les mocks suivent cet
 * ordre : `execute` sert les lectures, `connectionExecute` les écritures.
 */
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

const member = (...roles: string[]) => [[{ roles_json: JSON.stringify(roles) }]];
const absent = [[]];

describe("transferTeamOwnership", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("déplace OWNER vers la cible et conserve les autres rôles de chacun", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(member("OWNER", "CAPITAINE", "TANK")) // demandeur
      .mockResolvedValueOnce(member("DPS")); // cible
    const connectionExecute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const connection = await mockDb(execute, connectionExecute);

    await transferTeamOwnership(1, 7, 2);

    // L'ancien propriétaire perd OWNER mais garde CAPITAINE et TANK.
    const [oldSql, oldParams] = connectionExecute.mock.calls[0] as [string, unknown[]];
    expect(oldSql).toMatch(/UPDATE bg_team_members/);
    expect(oldParams).toEqual([JSON.stringify(["CAPITAINE", "TANK"]), 7, 1]);

    // Le nouveau propriétaire reçoit OWNER en tête, sans perdre son rôle de jeu.
    const [, newParams] = connectionExecute.mock.calls[1] as [string, unknown[]];
    expect(newParams).toEqual([JSON.stringify(["OWNER", "DPS"]), 7, 2]);

    expect(connection.commit).toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("laisse l'ancien propriétaire dans l'équipe avec un rôle par défaut", async () => {
    // Un membre sans aucun rôle n'existe pas côté modèle : OWNER seul retombe
    // sur DPS, comme à l'arrivée d'un membre (`addTeamMember`).
    const execute = jest
      .fn()
      .mockResolvedValueOnce(member("OWNER"))
      .mockResolvedValueOnce(member("HEAL"));
    const connectionExecute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute, connectionExecute);

    await transferTeamOwnership(1, 7, 2);

    const [, oldParams] = connectionExecute.mock.calls[0] as [string, unknown[]];
    expect(oldParams).toEqual([JSON.stringify(["DPS"]), 7, 1]);
  });

  it("ne duplique pas OWNER si la cible le porte déjà", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(member("OWNER"))
      .mockResolvedValueOnce(member("OWNER", "TANK"));
    const connectionExecute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute, connectionExecute);

    await transferTeamOwnership(1, 7, 2);

    const [, newParams] = connectionExecute.mock.calls[1] as [string, unknown[]];
    expect(newParams).toEqual([JSON.stringify(["OWNER", "TANK"]), 7, 2]);
  });

  it("refuse un transfert vers soi-même sans toucher à la base", async () => {
    const execute = jest.fn();
    await mockDb(execute);

    await expect(transferTeamOwnership(5, 7, 5)).rejects.toThrow("TRANSFER_TO_SELF");
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuse un demandeur étranger à l'équipe", async () => {
    const execute = jest.fn().mockResolvedValueOnce(absent);
    const connectionExecute = jest.fn();
    await mockDb(execute, connectionExecute);

    await expect(transferTeamOwnership(1, 7, 2)).rejects.toThrow("FORBIDDEN");
    expect(connectionExecute).not.toHaveBeenCalled();
  });

  it.each([["MANAGER"], ["CAPITAINE"], ["DPS"]])(
    "refuse un demandeur %s : seul le propriétaire transfère",
    async (role) => {
      const execute = jest.fn().mockResolvedValueOnce(member(role));
      const connectionExecute = jest.fn();
      await mockDb(execute, connectionExecute);

      await expect(transferTeamOwnership(1, 7, 2)).rejects.toThrow("FORBIDDEN");
      expect(connectionExecute).not.toHaveBeenCalled();
    },
  );

  it("refuse une cible qui n'est pas membre de l'équipe", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(member("OWNER"))
      .mockResolvedValueOnce(absent);
    const connectionExecute = jest.fn();
    await mockDb(execute, connectionExecute);

    await expect(transferTeamOwnership(1, 7, 2)).rejects.toThrow("MEMBER_NOT_FOUND");
    expect(connectionExecute).not.toHaveBeenCalled();
  });

  it("refuse sur une équipe fantôme, qui n'a aucun membre", async () => {
    // Une fantôme s'attribue (`claimGhostTeam`), elle ne se transfère pas :
    // faute de ligne `bg_team_members`, le demandeur n'est jamais OWNER.
    const execute = jest.fn().mockResolvedValueOnce(absent);
    await mockDb(execute);

    await expect(transferTeamOwnership(1, 7, 2)).rejects.toThrow("FORBIDDEN");
  });

  it("annule la transaction si une écriture échoue", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(member("OWNER", "TANK"))
      .mockResolvedValueOnce(member("DPS"));
    const connectionExecute = jest
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce(new Error("DB_DOWN"));
    const connection = await mockDb(execute, connectionExecute);

    await expect(transferTeamOwnership(1, 7, 2)).rejects.toThrow("DB_DOWN");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("ne touche qu'aux adhésions actives des deux joueurs", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(member("OWNER"))
      .mockResolvedValueOnce(member("DPS"));
    const connectionExecute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
    await mockDb(execute, connectionExecute);

    await transferTeamOwnership(1, 7, 2);

    expect(connectionExecute).toHaveBeenCalledTimes(2);
    for (const [sql] of connectionExecute.mock.calls as [string, unknown[]][]) {
      expect(sql).toMatch(/WHERE team_id = \?/);
      expect(sql).toMatch(/AND user_id = \?/);
      expect(sql).toMatch(/AND left_at IS NULL/);
    }
  });
});
