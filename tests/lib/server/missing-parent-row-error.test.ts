import { describe, expect, it } from "@jest/globals";
import { isMissingParentRowError } from "@/lib/server/mysql-errors";

const withCode = (code: string) => Object.assign(new Error(code), { code });

describe("isMissingParentRowError", () => {
  it("isMissingParentRowError_noReferencedRow2_returnsTrue", () => {
    expect(isMissingParentRowError(withCode("ER_NO_REFERENCED_ROW_2"))).toBe(true);
  });

  it("isMissingParentRowError_legacyNoReferencedRow_returnsTrue", () => {
    expect(isMissingParentRowError(withCode("ER_NO_REFERENCED_ROW"))).toBe(true);
  });

  it("isMissingParentRowError_otherCodes_returnsFalse", () => {
    expect(isMissingParentRowError(withCode("ER_DUP_ENTRY"))).toBe(false);
    expect(isMissingParentRowError(withCode("ER_ROW_IS_REFERENCED_2"))).toBe(false);
    expect(isMissingParentRowError(new Error("no code"))).toBe(false);
  });
});
