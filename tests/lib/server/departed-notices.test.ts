import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/match-reminders");

import {
  discardDepartedNotices,
  flushDepartedNotices,
  noteDepartedEntrants,
} from "@/lib/server/tournaments/departed-notices";
import { announceEntrantsWithdrawn } from "@/lib/server/tournaments/match-reminders";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

const AHEAD = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
const DEPARTURE = { matchId: 31, teamId: 101, slot: 2 as const };

/** Connexion dont la lecture des marques `TOLD` rend `held` (manche → horaire). */
function connectionHolding(held: Record<number, Date | string | null>) {
  const mock = connectionMock();
  mock.execute.mockResolvedValue([
    Object.entries(held).map(([matchId, startAt]) => ({ match_id: Number(matchId), start_at: startAt })),
  ]);
  return { mock, connection: fakeConnection(mock) };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(announceEntrantsWithdrawn).mockResolvedValue(1);
});

describe("noteDepartedEntrants puis flushDepartedNotices", () => {
  it("prévient après le commit l'engagée qui tenait un horaire, avec cet horaire", async () => {
    const { mock, connection } = connectionHolding({ 31: AHEAD });

    await noteDepartedEntrants(connection, [DEPARTURE]);
    expect(announceEntrantsWithdrawn).not.toHaveBeenCalled();
    const [sql, params] = mock.execute.mock.calls[0] as unknown as [string, unknown[]];
    // Lecture verrouillante : l'état le plus récent, que l'effacement verrouille de toute façon.
    expect(sql).toMatch(
      /^SELECT match_id, start_at FROM bg_match_reminders\s+WHERE match_id IN \(\?\) AND offset_key = \?\s+FOR UPDATE$/,
    );
    expect(params).toEqual([31, "TOLD"]);

    flushDepartedNotices(connection);
    expect(announceEntrantsWithdrawn).toHaveBeenCalledWith([{ ...DEPARTURE, heldStartAt: AHEAD }]);
    // Une seule fois : la file est vidée.
    flushDepartedNotices(connection);
    expect(announceEntrantsWithdrawn).toHaveBeenCalledTimes(1);
  });

  it("lit les marques de toutes les sortantes en une requête", async () => {
    const { mock, connection } = connectionHolding({ 31: AHEAD, 32: AHEAD });
    await noteDepartedEntrants(connection, [
      { matchId: 31, teamId: 101, slot: 1 },
      { matchId: 31, teamId: 102, slot: 2 },
      { matchId: 32, teamId: 103, slot: 1 },
    ]);
    expect(mock.execute).toHaveBeenCalledTimes(1);
    expect((mock.execute.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual([31, 32, "TOLD"]);
    flushDepartedNotices(connection);
    expect(jest.mocked(announceEntrantsWithdrawn).mock.calls[0][0]).toHaveLength(3);
  });

  it("ne lit rien sans sortante", async () => {
    const { mock, connection } = connectionHolding({});
    await noteDepartedEntrants(connection, []);
    expect(mock.execute).not.toHaveBeenCalled();
  });

  it("ne prévient de rien sans horaire reçu, ou après un retrait remis", async () => {
    const helds: Record<number, Date | string | null>[] = [{}, { 31: null }];
    for (const held of helds) {
      const { connection } = connectionHolding(held);
      await noteDepartedEntrants(connection, [DEPARTURE]);
      flushDepartedNotices(connection);
    }
    expect(announceEntrantsWithdrawn).not.toHaveBeenCalled();
  });

  it("ne prévient pas d'un horaire passé depuis plus de 12 heures, mais d'un horaire passé de peu", async () => {
    const old = connectionHolding({ 31: new Date(Date.now() - 13 * 60 * 60 * 1000) });
    await noteDepartedEntrants(old.connection, [DEPARTURE]);
    flushDepartedNotices(old.connection);
    expect(announceEntrantsWithdrawn).not.toHaveBeenCalled();

    const late = connectionHolding({ 31: new Date(Date.now() - 60 * 60 * 1000) });
    await noteDepartedEntrants(late.connection, [DEPARTURE]);
    flushDepartedNotices(late.connection);
    expect(announceEntrantsWithdrawn).toHaveBeenCalledTimes(1);
  });

  it("borne la file d'une transaction", async () => {
    const { connection } = connectionHolding({ 31: AHEAD });
    const many = Array.from({ length: 40 }, (_, index) => ({ matchId: 31, teamId: 200 + index, slot: 1 as const }));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await noteDepartedEntrants(connection, many);
    flushDepartedNotices(connection);
    expect(jest.mocked(announceEntrantsWithdrawn).mock.calls[0][0]).toHaveLength(32);
    // Le dépassement se dit dans pm2.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("8 avis"));
    warn.mockRestore();
  });

  it("jette les avis d'une correction qui n'a pas abouti", async () => {
    const { connection } = connectionHolding({ 31: AHEAD });
    await noteDepartedEntrants(connection, [DEPARTURE]);
    discardDepartedNotices(connection);
    flushDepartedNotices(connection);
    expect(announceEntrantsWithdrawn).not.toHaveBeenCalled();
  });

  it("tolère une table absente, et laisse passer toute autre erreur", async () => {
    const missing = connectionMock();
    missing.execute.mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    await expect(noteDepartedEntrants(fakeConnection(missing), [DEPARTURE])).resolves.toBeUndefined();

    const failing = connectionMock();
    failing.execute.mockRejectedValue(new Error("deadlock"));
    await expect(noteDepartedEntrants(fakeConnection(failing), [DEPARTURE])).rejects.toThrow("deadlock");
  });

  it("n'échoue jamais à l'envoi : l'erreur va dans les journaux", async () => {
    jest.mocked(announceEntrantsWithdrawn).mockRejectedValue(new Error("bot éteint"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { connection } = connectionHolding({ 31: AHEAD });
    await noteDepartedEntrants(connection, [DEPARTURE]);

    expect(() => flushDepartedNotices(connection)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
