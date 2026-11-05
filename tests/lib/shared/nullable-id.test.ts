import { describe, expect, it } from "@jest/globals";
import { nullableId } from "@/lib/shared/nullable-id";

describe("nullableId", () => {
  it("nullableId_bigintString_number", () => {
    expect(nullableId("12")).toBe(12);
  });

  it("nullableId_number_sameNumber", () => {
    expect(nullableId(7)).toBe(7);
  });

  it("nullableId_nullOrMissing_null", () => {
    expect(nullableId(null)).toBeNull();
    expect(nullableId(undefined)).toBeNull();
  });
});
