import { describe, expect, it } from "@jest/globals";
import {
  ABOUT_PILLAR_FIELD_ERRORS,
  ABOUT_PILLAR_TEXT_MAX,
  ABOUT_PILLAR_TITLE_MAX,
  FALLBACK_ABOUT_PILLARS,
  aboutPillarErrorMessage,
  aboutPillarHasEnglish,
  localizedAboutPillars,
  validateAboutPillarInput,
  type AboutPillar,
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
    const result = validateAboutPillarInput({ titleEn: "Title", textEn: "Text", title: "Accessible", text: "Inscription gratuite." });
    expect(result).toEqual({
      ok: true,
      value: { title: "Accessible", text: "Inscription gratuite.", titleEn: "Title", textEn: "Text" },
    });
  });

  it("trims title and text", () => {
    const result = validateAboutPillarInput({ titleEn: "Title", textEn: "Text", title: "  Accessible ", text: "  Inscription gratuite. " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Accessible");
      expect(result.value.text).toBe("Inscription gratuite.");
    }
  });

  it("rejects a missing title", () => {
    expect(validateAboutPillarInput({ titleEn: "Title", textEn: "Text", title: "  ", text: "Inscription gratuite." })).toEqual({
      ok: false,
      error: "TITLE_REQUIRED",
    });
  });

  it("rejects a missing text", () => {
    expect(validateAboutPillarInput({ titleEn: "Title", textEn: "Text", title: "Accessible", text: "" })).toEqual({
      ok: false,
      error: "TEXT_REQUIRED",
    });
  });

  it("rejects an over-long title", () => {
    expect(
      validateAboutPillarInput({ titleEn: "Title", textEn: "Text", title: "a".repeat(ABOUT_PILLAR_TITLE_MAX + 1), text: "T" }),
    ).toEqual({ ok: false, error: "TITLE_TOO_LONG" });
  });

  it("rejects an over-long text", () => {
    expect(
      validateAboutPillarInput({ titleEn: "Title", textEn: "Text", title: "T", text: "a".repeat(ABOUT_PILLAR_TEXT_MAX + 1) }),
    ).toEqual({ ok: false, error: "TEXT_TOO_LONG" });
  });

  it("ignores non-string fields", () => {
    const result = validateAboutPillarInput({ titleEn: "Title", textEn: "Text", title: 42 as unknown as string, text: "Inscription gratuite." });
    expect(result).toEqual({ ok: false, error: "TITLE_REQUIRED" });
  });
});

describe("validateAboutPillarInput — anglais (lot 5b, D9)", () => {
  it("demande l'anglais du titre puis du texte", () => {
    expect(validateAboutPillarInput({ title: "T", text: "X" })).toEqual({ ok: false, error: "TITLE_EN_REQUIRED" });
    expect(validateAboutPillarInput({ title: "T", text: "X", titleEn: "T" })).toEqual({ ok: false, error: "TEXT_EN_REQUIRED" });
    expect(validateAboutPillarInput({ title: "T", text: "X", titleEn: "T", textEn: "x".repeat(ABOUT_PILLAR_TEXT_MAX + 1) })).toEqual({
      ok: false,
      error: "TEXT_EN_TOO_LONG",
    });
    expect(ABOUT_PILLAR_FIELD_ERRORS.TEXT_EN_REQUIRED).toBe("textEn");
  });
});

describe("localizedAboutPillars", () => {
  const pillars: AboutPillar[] = [
    { id: 1, title: "Accessible", text: "Gratuit.", titleEn: "Accessible", textEn: "Free." },
    { id: 2, title: "Compétitif", text: "Arbitré.", titleEn: "Competitive", textEn: null },
  ];

  it("sous /en, une carte n'est rendue qu'avec titre et texte anglais", () => {
    expect(localizedAboutPillars(pillars, "en")).toEqual([{ pillar: pillars[0], title: "Accessible", text: "Free.", index: 0 }]);
    expect(localizedAboutPillars(pillars, "fr")).toHaveLength(2);
    expect(aboutPillarHasEnglish(pillars[1])).toBe(false);
  });

  it("les cartes de secours ont leur anglais", () => {
    expect(localizedAboutPillars(FALLBACK_ABOUT_PILLARS, "en")).toHaveLength(FALLBACK_ABOUT_PILLARS.length);
  });

  it("phrase un refus d'anglais", () => {
    expect(aboutPillarErrorMessage("TITLE_EN_TOO_LONG", "x")).toBe("Traduction anglaise trop longue.");
  });
});

