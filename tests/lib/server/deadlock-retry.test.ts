import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fail } from "@/lib/server/http";
import {
  isAutoIncrementContention,
  isContentionError,
  isContentionMessage,
  isDeadlockMessage,
  isSnapshotConflict,
  isTransactionAborted,
  isTransactionAbortedOn,
} from "@/lib/server/mysql-errors";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";
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

  // Revue perf #542 : liste unique — l'interblocage en fait partie.
  it("isContentionMessage_deadlock_returnsTrue", () => {
    expect(isContentionMessage(DEADLOCK)).toBe(true);
  });

  it("isContentionMessage_otherText_returnsFalse", () => {
    expect(isContentionMessage(`Erreur : ${LOCK_WAIT}`)).toBe(false);
    expect(isContentionMessage("Record has changed since last read in tablespace")).toBe(false);
    expect(isContentionMessage("ER_CHECKREAD")).toBe(false);
  });

  it("isContentionMessage_nonString_returnsFalse", () => {
    expect(isContentionMessage(undefined)).toBe(false);
    expect(isContentionMessage(1020)).toBe(false);
  });
});

describe("isContentionError", () => {
  it("isContentionError_checkreadCodeWithLocalizedMessage_returnsTrue", () => {
    const localized = Object.assign(new Error("L'enregistrement a changé depuis la dernière lecture"), { code: "ER_CHECKREAD" });

    expect(isContentionError(localized)).toBe(true);
  });

  it("isContentionError_lockWaitCode_returnsTrue", () => {
    expect(isContentionError(Object.assign(new Error("délai dépassé"), { code: "ER_LOCK_WAIT_TIMEOUT" }))).toBe(true);
  });

  it("isContentionError_deadlockCode_returnsTrue", () => {
    expect(isContentionError(Object.assign(new Error("interblocage"), { code: "ER_LOCK_DEADLOCK" }))).toBe(true);
  });

  it("isContentionError_errnoOnly_returnsTrue", () => {
    expect(isContentionError(Object.assign(new Error("x"), { errno: 1020 }))).toBe(true);
    expect(isContentionError(Object.assign(new Error("x"), { errno: 1205 }))).toBe(true);
    expect(isContentionError(Object.assign(new Error("x"), { errno: 1213 }))).toBe(true);
  });

  it("isContentionError_messageWithoutCode_returnsTrue", () => {
    expect(isContentionError(new Error(LOCK_WAIT))).toBe(true);
    expect(isContentionError(new Error(DEADLOCK))).toBe(true);
    expect(isContentionError(new Error("Record has changed since last read in table 'bg_matches'"))).toBe(true);
  });

  it("isContentionError_otherError_returnsFalse", () => {
    expect(isContentionError(Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 }))).toBe(false);
    expect(isContentionError(new Error("boom"))).toBe(false);
  });

  it("isContentionError_nonError_returnsFalse", () => {
    expect(isContentionError(null)).toBe(false);
    expect(isContentionError(LOCK_WAIT)).toBe(false);
    expect(isContentionError(undefined)).toBe(false);
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

  it("launchFailure_localizedCheckreadWithCode_returns409RetryCode", async () => {
    const conflict = Object.assign(new Error("Enregistrement modifié"), { code: "ER_CHECKREAD" });

    const response = launchFailure(conflict, {}, "MATCH_READY_FAILED");

    expect(response.status).toBe(409);
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

// Revue #542 : un seul prédicat du conflit d'image, partagé par le rejeu et le 409.
describe("isSnapshotConflict", () => {
  it("isSnapshotConflict_checkreadCodeOrErrno_returnsTrue", () => {
    expect(isSnapshotConflict(Object.assign(new Error("x"), { code: "ER_CHECKREAD" }))).toBe(true);
    expect(isSnapshotConflict(Object.assign(new Error("x"), { errno: 1020 }))).toBe(true);
  });

  it("isSnapshotConflict_otherOrNonError_returnsFalse", () => {
    expect(isSnapshotConflict(Object.assign(new Error("x"), { code: "ER_LOCK_DEADLOCK", errno: 1213 }))).toBe(false);
    expect(isSnapshotConflict(null)).toBe(false);
    expect(isSnapshotConflict("ER_CHECKREAD")).toBe(false);
  });
});

describe("ER_AUTOINC_READ_FAILED — interblocage sur le verrou AUTO-INC", () => {
  const AUTOINC = "Failed to read auto-increment value from storage engine";
  const autoInc = () => Object.assign(new Error(AUTOINC), { code: "ER_AUTOINC_READ_FAILED", errno: 1467 });

  it("isAutoIncrementContention_code_returnsTrue", () => {
    expect(isAutoIncrementContention(Object.assign(new Error("message localisé"), { code: "ER_AUTOINC_READ_FAILED" }))).toBe(true);
  });

  it("isAutoIncrementContention_errnoOnly_returnsTrue", () => {
    expect(isAutoIncrementContention(Object.assign(new Error("message localisé"), { errno: 1467 }))).toBe(true);
  });

  it("isAutoIncrementContention_otherError_returnsFalse", () => {
    expect(isAutoIncrementContention(Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 }))).toBe(false);
    expect(isAutoIncrementContention(new Error(AUTOINC))).toBe(false);
    expect(isAutoIncrementContention(null)).toBe(false);
  });

  it("isTransactionAborted_autoIncReadFailed_returnsTrue", () => {
    expect(isTransactionAborted(autoInc())).toBe(true);
  });

  it("isTransactionAborted_lockWaitTimeout_returnsFalse", () => {
    expect(isTransactionAborted(Object.assign(new Error(LOCK_WAIT), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }))).toBe(false);
  });

  it("isContentionError_autoIncReadFailed_returnsTrue", () => {
    expect(isContentionError(autoInc())).toBe(true);
  });

  it("isContentionMessage_autoIncMessage_returnsTrue", () => {
    expect(isContentionMessage(AUTOINC)).toBe(true);
  });

  it("isContentionMessage_prefixedAutoIncMessage_returnsFalse", () => {
    expect(isContentionMessage(`Erreur : ${AUTOINC}`)).toBe(false);
  });

  it("fail_autoIncMessage_returns409", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const response = fail(AUTOINC, 500);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: CONCURRENT_UPDATE_RETRY });
    warn.mockRestore();
  });
});

describe("isTransactionAbortedOn — 1467 tranché par l'état du serveur", () => {
  const autoInc = () => Object.assign(new Error("Failed to read auto-increment value from storage engine"), { errno: 1467 });

  it("isTransactionAbortedOn_autoIncTransactionClosed_returnsTrue", async () => {
    const connection = connectionMock();
    connection.query.mockResolvedValue([{ serverStatus: 2 }]);

    expect(await isTransactionAbortedOn(fakeConnection(connection), autoInc())).toBe(true);
    expect(connection.query).toHaveBeenCalledWith("DO 0");
  });

  it("isTransactionAbortedOn_autoIncTransactionStillOpen_returnsFalse", async () => {
    // Délai de verrou dépassé : la requête seule est annulée, la transaction reste.
    const connection = connectionMock();
    connection.query.mockResolvedValue([{ serverStatus: 3 }]);

    expect(await isTransactionAbortedOn(fakeConnection(connection), autoInc())).toBe(false);
  });

  it("isTransactionAbortedOn_statusCheckFails_returnsTrue", async () => {
    const connection = connectionMock();
    connection.query.mockRejectedValue(new Error("connexion tombée"));

    expect(await isTransactionAbortedOn(fakeConnection(connection), autoInc())).toBe(true);
  });

  it("isTransactionAbortedOn_deadlock_returnsTrueWithoutQuery", async () => {
    const connection = connectionMock();

    expect(await isTransactionAbortedOn(fakeConnection(connection), Object.assign(new Error("x"), { code: "ER_LOCK_DEADLOCK" }))).toBe(true);
    expect(connection.query).not.toHaveBeenCalled();
  });

  it("isTransactionAbortedOn_lockWaitTimeout_returnsFalseWithoutQuery", async () => {
    const connection = connectionMock();

    expect(await isTransactionAbortedOn(fakeConnection(connection), Object.assign(new Error("x"), { code: "ER_LOCK_WAIT_TIMEOUT" }))).toBe(false);
    expect(connection.query).not.toHaveBeenCalled();
  });
});
