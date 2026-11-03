import { describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import { boundLockWait, releaseWithServerLockWait, SHORT_LOCK_WAIT_SECONDS } from "@/lib/server/tournaments/lock-wait";
import { connectionMock } from "../../helpers/sql-double";

/**
 * Attente de verrou bornée des gestes du staff qui tiennent le tournoi
 * (ERREUR.txt EF-15) : annulation d'un abandon, retrait d'une pénalité.
 */

function connection() {
  const conn = { ...connectionMock(), destroy: jest.fn<() => void>() };
  return { conn, asPool: conn as unknown as PoolConnection };
}

describe("boundLockWait", () => {
  it("boundLockWait_setsSessionTimeoutToFiveSeconds", async () => {
    const { conn, asPool } = connection();

    await boundLockWait(asPool);

    expect(SHORT_LOCK_WAIT_SECONDS).toBe(5);
    expect(conn.query).toHaveBeenCalledWith("SET SESSION innodb_lock_wait_timeout = 5");
  });
});

describe("releaseWithServerLockWait", () => {
  it("releaseWithServerLockWait_restoreSucceeds_releasesToPool", async () => {
    const { conn, asPool } = connection();

    await releaseWithServerLockWait(asPool);

    expect(conn.query).toHaveBeenCalledWith("SET SESSION innodb_lock_wait_timeout = DEFAULT");
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(conn.destroy).not.toHaveBeenCalled();
  });

  it("releaseWithServerLockWait_restoreFails_destroysInsteadOfReleasing", async () => {
    const { conn, asPool } = connection();
    conn.query.mockRejectedValueOnce(new Error("Connection lost"));

    await releaseWithServerLockWait(asPool);

    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
  });
});
