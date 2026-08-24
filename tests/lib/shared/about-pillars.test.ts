import { describe, expect, it } from "@jest/globals";
import {
  ABOUT_PILLAR_TEXT_MAX,
  ABOUT_PILLAR_TITLE_MAX,
  validateAboutPillarInput,
} from "@/lib/shared/about-pillars";

describe("validateAboutPillarInput", () => {
  it("accepts a valid input", () => {
    const result = validateAboutPillarInput({ title: "Accessible", text: "Inscription gratuite." });
    expect(result).toEqual({ ok: true, value: { title: "Accessible", text: "Inscription gratuite." } });
  });

  it("trims title and text", () => {
    const result = validateAboutPillarInput({ title: "  Accessible ", text: "  Inscription gratuite. " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Accessible");
      expect(result.value.text).toBe("Inscription gratuite.");
    }
  });

  it("rejects a missing title", () => {
    expect(validateAboutPillarInput({ title: "  ", text: "Inscription gratuite." })).toEqual({
      ok: false,
      error: "TITLE_REQUIRED",
    });
  });

  it("rejects a missing text", () => {
    expect(validateAboutPillarInput({ title: "Accessible", text: "" })).toEqual({
      ok: false,
      error: "TEXT_REQUIRED",
    });
  });

  it("rejects an over-long title", () => {
    expect(
      validateAboutPillarInput({ title: "a".repeat(ABOUT_PILLAR_TITLE_MAX + 1), text: "T" }),
    ).toEqual({ ok: false, error: "TITLE_TOO_LONG" });
  });

  it("rejects an over-long text", () => {
    expect(
      validateAboutPillarInput({ title: "T", text: "a".repeat(ABOUT_PILLAR_TEXT_MAX + 1) }),
    ).toEqual({ ok: false, error: "TEXT_TOO_LONG" });
  });

  it("ignores non-string fields", () => {
    const result = validateAboutPillarInput({ title: 42 as unknown as string, text: "Inscription gratuite." });
    expect(result).toEqual({ ok: false, error: "TITLE_REQUIRED" });
  });
});
