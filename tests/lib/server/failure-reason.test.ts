import { describe, expect, it } from "@jest/globals";
import { failureReason } from "@/lib/server/failure-reason";

describe("failureReason", () => {
  it("failureReason_mysqlErrorWithCode_returnsCodeOnly", () => {
    const error = Object.assign(new Error("Duplicate entry 'Renards' for key"), {
      code: "ER_DUP_ENTRY",
      sqlMessage: "Duplicate entry 'Renards' for key",
    });
    expect(failureReason(error)).toBe("ER_DUP_ENTRY");
  });

  it("failureReason_emptyCode_returnsMessage", () => {
    expect(failureReason(Object.assign(new Error("BOT_DOWN"), { code: "" }))).toBe("BOT_DOWN");
  });

  it("failureReason_nonStringCode_returnsMessage", () => {
    expect(failureReason(Object.assign(new Error("BOT_DOWN"), { code: 1062 }))).toBe("BOT_DOWN");
  });

  it("failureReason_plainErrorMultiline_returnsFirstLine", () => {
    expect(failureReason(new Error("BOT_DOWN\n    at stack"))).toBe("BOT_DOWN");
  });

  it("failureReason_messageOver200Chars_truncatedTo200", () => {
    expect(failureReason(new Error(`${"a".repeat(200)}b`))).toBe("a".repeat(200));
  });

  it("failureReason_nonError_returnsUnknown", () => {
    expect(failureReason("boom")).toBe("erreur inconnue");
  });
});
