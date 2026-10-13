import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/match-reminders");

import {
  discardDepartedNotices,
  flushDepartedNotices,
  noteDepartedEntrant,
} from "@/lib/server/tournaments/departed-notices";
import { announceEntrantWithdrawn } from "@/lib/server/tournaments/match-reminders";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

const AHEAD = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

function connectionHolding(startAt: Date | string | null | undefined) {
  const mock = connectionMock();
  mock.execute.mockResolvedValue([startAt === undefined ? [] : [{ start_at: startAt }]]);
  return { mock, connection: fakeConnection(mock) };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(announceEntrantWithdrawn).mockResolvedValue(1);
});

describe("noteDepartedEntrant puis flushDepartedNotices", () => {
  it("prévient après le commit l'engagée qui tenait un horaire, avec cet horaire", async () => {
    const { mock, connection } = connectionHolding(AHEAD);

    await noteDepartedEntrant(connection, 31, 101, 2);
    expect(announceEntrantWithdrawn).not.toHaveBeenCalled();
    const [sql, params] = mock.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/^SELECT start_at FROM bg_match_reminders WHERE match_id = \? AND offset_key = \?/);
    expect(params).toEqual([31, "TOLD"]);

    flushDepartedNotices(connection);
    expect(announceEntrantWithdrawn).toHaveBeenCalledWith({ matchId: 31, teamId: 101, slot: 2, heldStartAt: AHEAD });
    // Une seule fois : la file est vidée.
    flushDepartedNotices(connection);
    expect(announceEntrantWithdrawn).toHaveBeenCalledTimes(1);
  });

  it("ne prévient de rien sans horaire reçu, ou après un retrait remis", async () => {
    for (const held of [undefined, null]) {
      const { connection } = connectionHolding(held);
      await noteDepartedEntrant(connection, 31, 101, 1);
      flushDepartedNotices(connection);
    }
    expect(announceEntrantWithdrawn).not.toHaveBeenCalled();
  });

  it("ne prévient pas d'un horaire passé depuis plus de 12 heures", async () => {
    const { connection } = connectionHolding(new Date(Date.now() - 13 * 60 * 60 * 1000));
    await noteDepartedEntrant(connection, 31, 101, 1);
    flushDepartedNotices(connection);
    expect(announceEntrantWithdrawn).not.toHaveBeenCalled();
  });

  it("prévient encore d'un horaire passé de peu (match en retard)", async () => {
    const { connection } = connectionHolding(new Date(Date.now() - 60 * 60 * 1000));
    await noteDepartedEntrant(connection, 31, 101, 1);
    flushDepartedNotices(connection);
    expect(announceEntrantWithdrawn).toHaveBeenCalledTimes(1);
  });

  it("jette les avis d'une correction qui n'a pas abouti", async () => {
    const { connection } = connectionHolding(AHEAD);
    await noteDepartedEntrant(connection, 31, 101, 1);
    discardDepartedNotices(connection);
    flushDepartedNotices(connection);
    expect(announceEntrantWithdrawn).not.toHaveBeenCalled();
  });

  it("tolère une table absente, et laisse passer toute autre erreur", async () => {
    const missing = connectionMock();
    missing.execute.mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    await expect(noteDepartedEntrant(fakeConnection(missing), 31, 101, 1)).resolves.toBeUndefined();

    const failing = connectionMock();
    failing.execute.mockRejectedValue(new Error("deadlock"));
    await expect(noteDepartedEntrant(fakeConnection(failing), 31, 101, 1)).rejects.toThrow("deadlock");
  });

  it("n'échoue jamais à l'envoi : l'erreur va dans les journaux", async () => {
    jest.mocked(announceEntrantWithdrawn).mockRejectedValue(new Error("bot éteint"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { connection } = connectionHolding(AHEAD);
    await noteDepartedEntrant(connection, 31, 101, 1);

    expect(() => flushDepartedNotices(connection)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
