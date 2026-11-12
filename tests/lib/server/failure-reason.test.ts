import { describe, expect, it, jest } from "@jest/globals";
import { failureReason, isErrorCode, serviceErrorCode, unexpectedFailureCode } from "@/lib/server/failure-reason";
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
