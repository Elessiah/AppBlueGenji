import { describe, expect, it, jest } from "@jest/globals";
import {
  failureDiagnostic,
  failureReason,
  isErrorCode,
  serviceErrorCode,
  unexpectedFailureCode,
} from "@/lib/server/failure-reason";
import { CONCURRENT_UPDATE_RETRY } from "@/lib/shared/api-error-code";

describe("failureReason", () => {
  it("failureReason_mysqlErrorWithCode_returnsCodeOnly", () => {
    const error = Object.assign(new Error("Duplicate entry 'Renards' for key"), {
      code: "ER_DUP_ENTRY",
      sqlMessage: "Duplicate entry 'Renards' for key",
    });
    expect(failureReason(error)).toBe("ER_DUP_ENTRY");
  });

  it("failureReason_emptyCode_returnsCodeLikeMessage", () => {
    expect(failureReason(Object.assign(new Error("BOT_DOWN"), { code: "" }))).toBe("BOT_DOWN");
  });

  it("failureReason_nonStringCode_returnsCodeLikeMessage", () => {
    expect(failureReason(Object.assign(new Error("BOT_DOWN"), { code: 1062 }))).toBe("BOT_DOWN");
  });

  it("failureReason_freeTextCode_fallsBackToName", () => {
    expect(failureReason(Object.assign(new Error("boom"), { code: "connect to https://x failed" }))).toBe("Error");
  });

  it("failureReason_siteErrorCode_returnsMessage", () => {
    expect(failureReason(new Error("MATCH_NOT_FOUND"))).toBe("MATCH_NOT_FOUND");
  });

  it("failureReason_freeTextMessage_returnsErrorNameOnly", () => {
    expect(failureReason(new SyntaxError(`"Renards" is not valid JSON`))).toBe("SyntaxError");
  });

  it("failureReason_multilineMessage_returnsErrorNameOnly", () => {
    expect(failureReason(new Error("BOT_DOWN\n    at stack"))).toBe("Error");
  });

  it("failureReason_codeOf64Chars_returnsMessage", () => {
    expect(failureReason(new Error(`A${"B".repeat(63)}`))).toBe(`A${"B".repeat(63)}`);
  });

  it("failureReason_codeOf65Chars_returnsErrorNameOnly", () => {
    expect(failureReason(new Error(`A${"B".repeat(64)}`))).toBe("Error");
  });

  it("failureReason_nonError_returnsUnknown", () => {
    expect(failureReason("boom")).toBe("erreur inconnue");
  });
});

describe("isErrorCode", () => {
  it("isErrorCode_siteCode_returnsTrue", () => {
    expect(isErrorCode("ABOUT_STAT_NOT_FOUND")).toBe(true);
  });

  it("isErrorCode_freeText_returnsFalse", () => {
    expect(isErrorCode("connect ECONNREFUSED 127.0.0.1:3306")).toBe(false);
  });

  it("isErrorCode_65Chars_returnsFalse", () => {
    expect(isErrorCode(`A${"B".repeat(64)}`)).toBe(false);
  });
});

describe("serviceErrorCode", () => {
  it("serviceErrorCode_siteCode_returnsMessage", () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(serviceErrorCode(new Error("LABEL_TOO_LONG"), "THING_CREATE_FAILED")).toBe("LABEL_TOO_LONG");
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("serviceErrorCode_driverText_returnsFallbackAndLogsCodeOnly", () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const actual = serviceErrorCode(new Error("connect ECONNREFUSED 10.0.0.5:3306"), "THING_CREATE_FAILED");

    expect(actual).toBe("THING_CREATE_FAILED");
    expect(logged).toHaveBeenCalledWith("[api] THING_CREATE_FAILED : Error");
    logged.mockRestore();
  });

  it("serviceErrorCode_emptyMessage_returnsFallback", () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(serviceErrorCode(new Error(""), "THING_CREATE_FAILED")).toBe("THING_CREATE_FAILED");
    logged.mockRestore();
  });

  it("serviceErrorCode_nonError_returnsFallback", () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const thrown: unknown = "LABEL_TOO_LONG";

    expect(serviceErrorCode(thrown, "THING_CREATE_FAILED")).toBe("THING_CREATE_FAILED");
    logged.mockRestore();
  });

  it("serviceErrorCode_deadlockError_returnsConcurrentUpdateRetry", () => {
    const warned = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const deadlock = Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), {
      code: "ER_LOCK_DEADLOCK",
      errno: 1213,
    });

    const actual = serviceErrorCode(deadlock, "THING_CREATE_FAILED");

    expect(actual).toBe(CONCURRENT_UPDATE_RETRY);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();
    warned.mockRestore();
    logged.mockRestore();
  });

  it("serviceErrorCode_lockWaitTimeoutErrno_returnsConcurrentUpdateRetry", () => {
    const warned = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const timeout = Object.assign(new Error("Délai d'attente du verrou dépassé"), { errno: 1205 });

    expect(serviceErrorCode(timeout, "THING_CREATE_FAILED")).toBe(CONCURRENT_UPDATE_RETRY);
    warned.mockRestore();
  });
});

describe("unexpectedFailureCode", () => {
  it("unexpectedFailureCode_contention_returnsConcurrentUpdateRetryAndWarnsCodeOnly", () => {
    const warned = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const deadlock = Object.assign(new Error("Deadlock found on row of Test_Pseudo"), {
      code: "ER_LOCK_DEADLOCK",
      errno: 1213,
    });

    expect(unexpectedFailureCode(deadlock, "THING_FAILED", "[thing]")).toBe(CONCURRENT_UPDATE_RETRY);

    expect(warned).toHaveBeenCalledWith(
      `[thing] : écriture concurrente, rendue en ${CONCURRENT_UPDATE_RETRY} (ER_LOCK_DEADLOCK)`,
    );
    expect(logged).not.toHaveBeenCalled();
    warned.mockRestore();
    logged.mockRestore();
  });

  it("unexpectedFailureCode_otherError_returnsFallbackAndLogsCodeOnly", () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(unexpectedFailureCode(new Error("disk full at /srv/Test_Pseudo"), "THING_FAILED", "[thing]")).toBe(
      "THING_FAILED",
    );

    expect(logged).toHaveBeenCalledWith("[thing] : Error");
    logged.mockRestore();
  });
});

/** Une erreur dont la pile est écrite à la main (cinq cadres V8). */
function withStack<E extends Error>(error: E, header: string): E {
  error.stack = [
    header,
    "    at replayRound (/app/lib/server/tournaments/swiss.ts:10:5)",
    "    at async syncTournament (/app/lib/server/tournaments/index.ts:20:7)",
    "    at /app/lib/server/tournaments/lobby-brief.ts:30:9",
    "    at runSweep (/app/lib/server/sweeps.ts:40:3)",
    "    at tick (/app/lib/server/sweeps.ts:50:3)",
  ].join("\n");
  return error;
}

describe("failureDiagnostic", () => {
  it("failureDiagnostic_codedError_returnsCodeOnly", () => {
    const error = withStack(
      Object.assign(new Error("Duplicate entry 'nova@example.test'"), { code: "ER_DUP_ENTRY" }),
      "Error: Duplicate entry 'nova@example.test'",
    );

    expect(failureDiagnostic(error)).toBe("ER_DUP_ENTRY");
  });

  it("failureDiagnostic_siteCodeMessage_returnsMessage", () => {
    expect(failureDiagnostic(new Error("BOT_DOWN"))).toBe("BOT_DOWN");
  });

  it("failureDiagnostic_unexpectedError_appendsUpToThreeFramesWithoutMessage", () => {
    const error = withStack(new TypeError("Cannot read 'NovaSecretPseudo'"), "TypeError: Cannot read 'NovaSecretPseudo'");

    expect(failureDiagnostic(error)).toBe(
      "TypeError at replayRound (/app/lib/server/tournaments/swiss.ts:10:5)" +
        " < at async syncTournament (/app/lib/server/tournaments/index.ts:20:7)" +
        " < at /app/lib/server/tournaments/lobby-brief.ts:30:9",
    );
  });

  it("failureDiagnostic_forgedFrameInMessage_ignored", () => {
    const message = "boom\n    at evil (/secret/nova.ts:1:1)";
    const error = withStack(new Error(message), `Error: ${message}`);

    const diagnostic = failureDiagnostic(error);

    expect(diagnostic).not.toContain("evil");
    expect(diagnostic).toContain("at replayRound (/app/lib/server/tournaments/swiss.ts:10:5)");
  });

  it("failureDiagnostic_noStack_returnsNameOnly", () => {
    const error = new RangeError("index 12 out of range");
    error.stack = undefined;

    expect(failureDiagnostic(error)).toBe("RangeError");
  });

  it("failureDiagnostic_thrownString_returnsUnknownWithType", () => {
    expect(failureDiagnostic("NovaSecretPseudo")).toBe("erreur inconnue (string)");
  });

  it("failureDiagnostic_thrownNull_returnsUnknownWithNull", () => {
    expect(failureDiagnostic(null)).toBe("erreur inconnue (null)");
  });

  it("failureDiagnostic_plainObjectWithCode_returnsCode", () => {
    expect(failureDiagnostic({ code: "ECONNREFUSED" })).toBe("ECONNREFUSED");
  });
});
