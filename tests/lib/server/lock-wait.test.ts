import { describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import {
  releaseWithServerLockWait,
  rollbackKeepingError,
  SHORT_LOCK_WAIT_SECONDS,
  withShortLockWait,
} from "@/lib/server/tournaments/lock-wait";
import { connectionMock } from "../../helpers/sql-double";

/**
 * Attente de verrou bornée des gestes du staff qui tiennent le tournoi
 * (ERREUR.txt EF-15) : annulation d'un abandon, retrait d'une pénalité.
 */

function connection() {
  const conn = { ...connectionMock(), destroy: jest.fn<() => void>() };
  return { conn, asPool: conn as unknown as PoolConnection };
}

describe("withShortLockWait", () => {
  it("withShortLockWait_nominal_boundsOnlyTheReadThenRestoresServerDefault", async () => {
    const { conn, asPool } = connection();
    const read = jest.fn(async () => {
      expect(conn.query.mock.calls.map(([sql]) => sql)).toEqual(["SET SESSION innodb_lock_wait_timeout = 5"]);
      return true;
    });

    await expect(withShortLockWait(asPool, read)).resolves.toBe(true);

    expect(SHORT_LOCK_WAIT_SECONDS).toBe(5);
    expect(read).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls.map(([sql]) => sql)).toEqual([
      "SET SESSION innodb_lock_wait_timeout = 5",
      "SET SESSION innodb_lock_wait_timeout = DEFAULT",
    ]);
  });

  // Revue #542 : le rejeu qui suit garde le délai du serveur, même si la
  // lecture bornée échoue (délai dépassé → 409).
  it("withShortLockWait_readTimesOut_restoresDefaultAndRethrows", async () => {
    const { conn, asPool } = connection();
    const timeout = Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT" });

    await expect(withShortLockWait(asPool, async () => Promise.reject(timeout))).rejects.toBe(timeout);

    expect(conn.query.mock.calls.at(-1)?.[0]).toBe("SET SESSION innodb_lock_wait_timeout = DEFAULT");
  });

  // Revue #542 : remise ratée après une lecture réussie — le geste s'arrête
  // plutôt que de poursuivre son rejeu sous le délai court.
  it("withShortLockWait_restoreFailsAfterRead_rejectsWithRestoreError", async () => {
    const { conn, asPool } = connection();
    const lost = new Error("Connection lost");
    conn.query.mockResolvedValueOnce([[], []]).mockRejectedValueOnce(lost);

    await expect(withShortLockWait(asPool, async () => false)).rejects.toBe(lost);
  });

  it("withShortLockWait_readAndRestoreFail_rethrowsReadError", async () => {
    const { conn, asPool } = connection();
    const timeout = Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT" });
    conn.query.mockResolvedValueOnce([[], []]).mockRejectedValueOnce(new Error("Connection lost"));

    await expect(withShortLockWait(asPool, async () => Promise.reject(timeout))).rejects.toBe(timeout);
  });
});

describe("releaseWithServerLockWait", () => {
  // Revue #542 : délai jamais raccourci, aucune requête de plus au retour.
  it("releaseWithServerLockWait_neverShortened_releasesWithoutQuery", async () => {
    const { conn, asPool } = connection();

    await releaseWithServerLockWait(asPool);

    expect(conn.query).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("releaseWithServerLockWait_alreadyRestored_releasesWithoutQuery", async () => {
    const { conn, asPool } = connection();
    await withShortLockWait(asPool, async () => true);
    conn.query.mockClear();

    await releaseWithServerLockWait(asPool);

    expect(conn.query).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("releaseWithServerLockWait_innerRestoreFailed_restoresThenReleases", async () => {
    const { conn, asPool } = connection();
    conn.query.mockResolvedValueOnce([[], []]).mockRejectedValueOnce(new Error("Connection lost"));
    await expect(withShortLockWait(asPool, async () => true)).rejects.toThrow("Connection lost");
    conn.query.mockClear();

    await releaseWithServerLockWait(asPool);

    expect(conn.query.mock.calls.map(([sql]) => sql)).toEqual(["SET SESSION innodb_lock_wait_timeout = DEFAULT"]);
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(conn.destroy).not.toHaveBeenCalled();
  });

  it("releaseWithServerLockWait_restoreFails_destroysInsteadOfReleasing", async () => {
    const { conn, asPool } = connection();
    conn.query.mockResolvedValueOnce([[], []]).mockRejectedValueOnce(new Error("Connection lost"));
    await expect(withShortLockWait(asPool, async () => true)).rejects.toThrow("Connection lost");
    conn.query.mockRejectedValueOnce(new Error("Connection lost"));

    await releaseWithServerLockWait(asPool);

    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
  });
});

// Revue sécurité #542 : un ROLLBACK raté ne masque pas l'erreur d'origine, et
// la connexion — transaction peut-être encore ouverte — n'est jamais rendue.
describe("rollbackKeepingError", () => {
  it("rollbackKeepingError_rollbackSucceeds_releasesNormally", async () => {
    const { conn, asPool } = connection();
    conn.rollback.mockResolvedValue(undefined);

    await rollbackKeepingError(asPool);
    await releaseWithServerLockWait(asPool);

    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(conn.destroy).not.toHaveBeenCalled();
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("rollbackKeepingError_rollbackFails_resolvesAndDestroysOnRelease", async () => {
    const { conn, asPool } = connection();
    conn.rollback.mockRejectedValue(new Error("Connection lost"));

    await expect(rollbackKeepingError(asPool)).resolves.toBeUndefined();
    await releaseWithServerLockWait(asPool);

    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
  });

  it("releaseWithServerLockWait_shortenedAndRollbackFailed_destroysWithoutRestoreQuery", async () => {
    const { conn, asPool } = connection();
    conn.query.mockResolvedValueOnce([[], []]).mockRejectedValueOnce(new Error("Connection lost"));
    await expect(withShortLockWait(asPool, async () => true)).rejects.toThrow("Connection lost");
    conn.rollback.mockRejectedValue(new Error("Connection lost"));
    await rollbackKeepingError(asPool);
    conn.query.mockClear();

    await releaseWithServerLockWait(asPool);

    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.query).not.toHaveBeenCalled();
    expect(conn.release).not.toHaveBeenCalled();
  });
});
