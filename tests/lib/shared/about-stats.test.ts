import { describe, expect, it } from "@jest/globals";
import {
  ABOUT_STAT_LABEL_MAX,
  ABOUT_STAT_VALUE_MAX,
  validateAboutStatInput,
} from "@/lib/shared/about-stats";

describe("validateAboutStatInput", () => {
  it("accepts a valid input", () => {
    const result = validateAboutStatInput({ value: "100%", label: "Bénévole" });
    expect(result).toEqual({ ok: true, value: { value: "100%", label: "Bénévole" } });
  });

  it("trims value and label", () => {
    const result = validateAboutStatInput({ value: "  €4 200 ", label: "  Prizepool 2025 " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe("€4 200");
      expect(result.value.label).toBe("Prizepool 2025");
    }
  });

  it("rejects a missing value", () => {
    expect(validateAboutStatInput({ value: "  ", label: "Bénévole" })).toEqual({
      ok: false,
      error: "VALUE_REQUIRED",
    });
  });

  it("rejects a missing label", () => {
    expect(validateAboutStatInput({ value: "100%", label: "" })).toEqual({
      ok: false,
      error: "LABEL_REQUIRED",
    });
  });

  it("rejects an over-long value", () => {
    expect(validateAboutStatInput({ value: "a".repeat(ABOUT_STAT_VALUE_MAX + 1), label: "L" })).toEqual({
      ok: false,
      error: "VALUE_TOO_LONG",
    });
  });

  it("rejects an over-long label", () => {
    expect(validateAboutStatInput({ value: "V", label: "a".repeat(ABOUT_STAT_LABEL_MAX + 1) })).toEqual({
      ok: false,
      error: "LABEL_TOO_LONG",
    });
  });

  it("ignores non-string fields", () => {
    const result = validateAboutStatInput({ value: 42 as unknown as string, label: "Bénévole" });
    expect(result).toEqual({ ok: false, error: "VALUE_REQUIRED" });
  });
});
