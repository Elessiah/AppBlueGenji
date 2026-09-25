import { describe, expect, it } from "@jest/globals";
import {
  ABOUT_PILLAR_TEXT_MAX,
  ABOUT_PILLAR_TITLE_MAX,
  FALLBACK_ABOUT_PILLARS,
  validateAboutPillarInput,
} from "@/lib/shared/about-pillars";

describe("FALLBACK_ABOUT_PILLARS", () => {
  it("ne promet rien que le site ne tient pas, ni de jargon anglais", () => {
    // « matchmaking par niveau » (le site n'en fait pas), « rulebook »,
    // « watch parties » et « scoreboard » traînaient dans les cartes de
    // secours de l'accueil — la seule page entièrement francisée du site.
    const forbidden = ["matchmaking", "rulebook", "watch part", "scoreboard"];
    for (const pillar of FALLBACK_ABOUT_PILLARS) {
      const lowered = pillar.text.toLowerCase();
      for (const term of forbidden) {
        expect(lowered).not.toContain(term);
      }
    }
  });

  it("reste dans les bornes de validation qu'il impose au staff", () => {
    for (const pillar of FALLBACK_ABOUT_PILLARS) {
      expect(pillar.title.length).toBeLessThanOrEqual(ABOUT_PILLAR_TITLE_MAX);
      expect(pillar.text.length).toBeLessThanOrEqual(ABOUT_PILLAR_TEXT_MAX);
    }
  });
});

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
