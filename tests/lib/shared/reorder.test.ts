import { describe, expect, it } from "@jest/globals";
import { validateReorderIds } from "@/lib/shared/reorder";

describe("validateReorderIds", () => {
  it("accepts a list of distinct positive integers", () => {
    expect(validateReorderIds([3, 1, 2])).toEqual({ ok: true, ids: [3, 1, 2] });
  });

  it("coerces numeric strings", () => {
    const result = validateReorderIds(["10", "20"]);
    expect(result).toEqual({ ok: true, ids: [10, 20] });
  });

  it("rejects a non-array payload", () => {
    expect(validateReorderIds("nope")).toEqual({ ok: false, error: "IDS_REQUIRED" });
    expect(validateReorderIds(undefined)).toEqual({ ok: false, error: "IDS_REQUIRED" });
  });

  it("rejects an empty list", () => {
    expect(validateReorderIds([])).toEqual({ ok: false, error: "IDS_EMPTY" });
  });

  it("rejects a non-integer id", () => {
    expect(validateReorderIds([1, 2.5])).toEqual({ ok: false, error: "INVALID_ID" });
  });

  it("rejects a zero or negative id", () => {
    expect(validateReorderIds([1, 0])).toEqual({ ok: false, error: "INVALID_ID" });
    expect(validateReorderIds([-1])).toEqual({ ok: false, error: "INVALID_ID" });
  });

  it("rejects a non-numeric value", () => {
    expect(validateReorderIds([1, "abc"])).toEqual({ ok: false, error: "INVALID_ID" });
  });

  it("rejects duplicates", () => {
    expect(validateReorderIds([1, 2, 1])).toEqual({ ok: false, error: "DUPLICATE_ID" });
  });
});
