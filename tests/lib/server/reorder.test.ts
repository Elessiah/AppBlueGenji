import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { applyDisplayOrder } from "@/lib/server/reorder";
import { connectionMock, fakeConnection, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/database");

/**
 * `applyDisplayOrder` réécrit l'ordre d'une table dans **une** transaction, et
 * laisse l'appelant y poser son contrôle (`beforeWrite`) : le statut des
 * annonces de recrutement s'y relit sous verrou. Ces tests tiennent l'ordre des
 * gestes — contrôle d'abord, écritures ensuite — et l'annulation d'un refus.
 */
describe("applyDisplayOrder", () => {
  let connection: ReturnType<typeof connectionMock>;

  beforeEach(async () => {
    jest.clearAllMocks();
    connection = connectionMock();
    connection.execute.mockResolvedValue([{ affectedRows: 1 }]);
    const { getDatabase } = await import("@/lib/server/database");
    jest
      .mocked(getDatabase)
      .mockResolvedValue(fakePool({ getConnection: async () => fakeConnection(connection) }));
  });

  it("écrit 10, 20, 30… dans l'ordre reçu, puis valide", async () => {
    await applyDisplayOrder("bg_sponsors", [7, 3, 5]);
    expect(connection.execute.mock.calls.map((call) => call[1])).toEqual([
      [10, 7],
      [20, 3],
      [30, 5],
    ]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("joue le contrôle dans la transaction, avant la première écriture", async () => {
    const order: string[] = [];
    connection.beginTransaction.mockImplementation(async () => {
      order.push("begin");
    });
    connection.execute.mockImplementation(async () => {
      order.push("write");
      return [{ affectedRows: 1 }];
    });
    const beforeWrite = jest.fn(async (conn: unknown) => {
      // Le contrôle reçoit la connexion de la transaction, pas le pool.
      expect(conn).toBe(connection);
      order.push("check");
    });

    await applyDisplayOrder("bg_recruitment_ads", [1, 2], beforeWrite);

    expect(order).toEqual(["begin", "check", "write", "write"]);
  });

  it("annule tout et relaie le refus du contrôle, sans rien écrire", async () => {
    const refusal = new Error("RECRUITMENT_ORDER_MIXES_PRIORITIES");
    await expect(
      applyDisplayOrder("bg_recruitment_ads", [1, 2], async () => {
        throw refusal;
      }),
    ).rejects.toBe(refusal);

    expect(connection.execute).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("annule tout quand une écriture échoue en cours de route", async () => {
    connection.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce(new Error("lock wait timeout"));

    await expect(applyDisplayOrder("bg_sponsors", [1, 2, 3])).rejects.toThrow("lock wait timeout");
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
