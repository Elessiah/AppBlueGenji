import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fail } from "@/lib/server/http";
import { isContentionMessage, isDeadlockMessage, isLockWaitTimeout } from "@/lib/server/mysql-errors";
import { launchFailure } from "@/lib/server/tournaments/match-launch-routes";
import { CONCURRENT_UPDATE_RETRY, CONCURRENT_UPDATE_RETRY_MESSAGE } from "@/lib/shared/api-error-code";
import { ERROR_MESSAGES, mapError } from "@/app/(secured)/tournois/[id]/_lib/error-map";

const DEADLOCK = "Deadlock found when trying to get lock; try restarting transaction";
const LOCK_WAIT = "Lock wait timeout exceeded; try restarting transaction";

describe("isDeadlockMessage", () => {
  it("reconnaît le message d'interblocage d'InnoDB", () => {
    expect(isDeadlockMessage(DEADLOCK)).toBe(true);
  });

  it("ignore les autres messages, codes et valeurs non textuelles", () => {
    expect(isDeadlockMessage("Lock wait timeout exceeded; try restarting transaction")).toBe(false);
    expect(isDeadlockMessage("ER_LOCK_DEADLOCK")).toBe(false);
    expect(isDeadlockMessage(`Erreur : ${DEADLOCK}`)).toBe(false);
    expect(isDeadlockMessage("")).toBe(false);
    expect(isDeadlockMessage(undefined)).toBe(false);
    expect(isDeadlockMessage(42)).toBe(false);
  });
});

describe("fail — interblocage", () => {
  let warn: ReturnType<typeof jest.spyOn>;
  let error: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    error = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  it("rend un 409 CONCURRENT_UPDATE_RETRY au lieu d'une panne générique", async () => {
    const response = fail(DEADLOCK, 500);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: CONCURRENT_UPDATE_RETRY });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("vaut quel que soit le statut demandé par la route", async () => {
    const response = fail(DEADLOCK, 400);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(CONCURRENT_UPDATE_RETRY);
  });

  it("garde les compléments joints au corps", async () => {
    const response = fail(DEADLOCK, 500, { teamId: 7 });
    expect(await response.json()).toEqual({ teamId: 7, error: CONCURRENT_UPDATE_RETRY });
  });

  it("laisse les autres erreurs MySQL en panne générique", async () => {
    const response = fail("Unknown column 'x' in 'field list'", 500);
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("INTERNAL_ERROR");
  });

  // ERREUR.txt EF-15 : les deux autres contentions passagères qu'un rejeu n'a
  // pas absorbées sont un refus « réessaie », pas une panne.
  it("fail_snapshotConflictMessage_returns409RetryCode", async () => {
    const response = fail("Record has changed since last read in table 'bg_matches'", 500);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: CONCURRENT_UPDATE_RETRY });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("fail_lockWaitTimeoutMessage_returns409RetryCode", async () => {
    const response = fail(LOCK_WAIT, 400);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(CONCURRENT_UPDATE_RETRY);
  });
});

describe("isContentionMessage", () => {
  it("isContentionMessage_snapshotConflict_returnsTrue", () => {
    expect(isContentionMessage("Record has changed since last read in table 'bg_matches'")).toBe(true);
  });

  it("isContentionMessage_lockWaitTimeout_returnsTrue", () => {
    expect(isContentionMessage(LOCK_WAIT)).toBe(true);
  });

  it("isContentionMessage_deadlockOrOtherText_returnsFalse", () => {
    expect(isContentionMessage(DEADLOCK)).toBe(false);
    expect(isContentionMessage(`Erreur : ${LOCK_WAIT}`)).toBe(false);
    expect(isContentionMessage("Record has changed since last read in tablespace")).toBe(false);
    expect(isContentionMessage("ER_CHECKREAD")).toBe(false);
  });

  it("isContentionMessage_nonString_returnsFalse", () => {
    expect(isContentionMessage(undefined)).toBe(false);
    expect(isContentionMessage(1020)).toBe(false);
  });
});

describe("isLockWaitTimeout", () => {
  it("isLockWaitTimeout_lockWaitCode_returnsTrue", () => {
    expect(isLockWaitTimeout(Object.assign(new Error(LOCK_WAIT), { code: "ER_LOCK_WAIT_TIMEOUT" }))).toBe(true);
  });

  it("isLockWaitTimeout_otherCode_returnsFalse", () => {
    expect(isLockWaitTimeout(Object.assign(new Error(DEADLOCK), { code: "ER_LOCK_DEADLOCK" }))).toBe(false);
    expect(isLockWaitTimeout(new Error(LOCK_WAIT))).toBe(false);
  });
});

describe("launchFailure — interblocage", () => {
  it("laisse passer l'interblocage au lieu du code de repli", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = launchFailure(new Error(DEADLOCK), {}, "MATCH_READY_FAILED");
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe(CONCURRENT_UPDATE_RETRY);
    } finally {
      warn.mockRestore();
    }
  });

  it("launchFailure_snapshotConflict_returns409RetryCode", async () => {
    const conflict = Object.assign(new Error("Record has changed since last read"), { code: "ER_CHECKREAD", errno: 1020 });

    const response = launchFailure(conflict, {}, "MATCH_READY_FAILED");

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(CONCURRENT_UPDATE_RETRY);
  });

  it("launchFailure_lockWaitTimeout_returns409RetryCode", async () => {
    const timeout = Object.assign(new Error(LOCK_WAIT), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });

    const response = launchFailure(timeout, {}, "MATCH_READY_FAILED");

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(CONCURRENT_UPDATE_RETRY);
  });

  it("launchFailure_snapshotConflictMessageWithoutCode_returns409RetryCode", async () => {
    const response = launchFailure(new Error("Record has changed since last read in table 'bg_matches'"), {}, "MATCH_READY_FAILED");

    expect(response.status).toBe(409);
  });

  it("garde le code de repli pour une erreur imprévue", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = launchFailure(new Error("boom"), {}, "MATCH_READY_FAILED");
      expect(response.status).toBe(500);
      expect((await response.json()).error).toBe("MATCH_READY_FAILED");
    } finally {
      error.mockRestore();
    }
  });
});

describe("message d'interface", () => {
  it("traduit le code en phrase qui invite à réessayer", () => {
    expect(ERROR_MESSAGES[CONCURRENT_UPDATE_RETRY]).toBe(CONCURRENT_UPDATE_RETRY_MESSAGE);
    expect(mapError(CONCURRENT_UPDATE_RETRY)).toBe(CONCURRENT_UPDATE_RETRY_MESSAGE);
    expect(CONCURRENT_UPDATE_RETRY_MESSAGE).toMatch(/Réessaie/);
  });
});
