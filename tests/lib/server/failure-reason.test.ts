import { describe, expect, it } from "@jest/globals";
import { failureReason, isErrorCode } from "@/lib/server/failure-reason";

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
