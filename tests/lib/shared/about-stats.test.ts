import { describe, expect, it } from "@jest/globals";
import {
  ABOUT_STAT_FIELD_ERRORS,
  ABOUT_STAT_LABEL_MAX,
  ABOUT_STAT_VALUE_MAX,
  FALLBACK_ABOUT_STATS,
  aboutStatErrorMessage,
  localizedAboutStats,
  validateAboutStatInput,
  type AboutStat,
} from "@/lib/shared/about-stats";

describe("validateAboutStatInput", () => {
  it("accepts a valid input", () => {
    const result = validateAboutStatInput({ labelEn: "Label", value: "100%", label: "Bénévole" });
    expect(result).toEqual({ ok: true, value: { value: "100%", label: "Bénévole", labelEn: "Label" } });
  });

  it("trims value and label", () => {
    const result = validateAboutStatInput({ labelEn: "Label", value: "  €4 200 ", label: "  Prizepool 2025 " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe("€4 200");
      expect(result.value.label).toBe("Prizepool 2025");
    }
  });

  it("rejects a missing value", () => {
    expect(validateAboutStatInput({ labelEn: "Label", value: "  ", label: "Bénévole" })).toEqual({
      ok: false,
      error: "VALUE_REQUIRED",
    });
  });

  it("rejects a missing label", () => {
    expect(validateAboutStatInput({ labelEn: "Label", value: "100%", label: "" })).toEqual({
      ok: false,
      error: "LABEL_REQUIRED",
    });
  });

  it("rejects an over-long value", () => {
    expect(validateAboutStatInput({ labelEn: "Label", value: "a".repeat(ABOUT_STAT_VALUE_MAX + 1), label: "L" })).toEqual({
      ok: false,
      error: "VALUE_TOO_LONG",
    });
  });

  it("rejects an over-long label", () => {
    expect(validateAboutStatInput({ labelEn: "Label", value: "V", label: "a".repeat(ABOUT_STAT_LABEL_MAX + 1) })).toEqual({
      ok: false,
      error: "LABEL_TOO_LONG",
    });
  });

  it("ignores non-string fields", () => {
    const result = validateAboutStatInput({ labelEn: "Label", value: 42 as unknown as string, label: "Bénévole" });
    expect(result).toEqual({ ok: false, error: "VALUE_REQUIRED" });
  });
});

describe("validateAboutStatInput — anglais du titre (lot 5b, D9)", () => {
  it("demande l'anglais du titre", () => {
    expect(validateAboutStatInput({ value: "12", label: "Arbitres" })).toEqual({ ok: false, error: "LABEL_EN_REQUIRED" });
    expect(validateAboutStatInput({ value: "12", label: "Arbitres", labelEn: "r".repeat(ABOUT_STAT_LABEL_MAX + 1) })).toEqual({
      ok: false,
      error: "LABEL_EN_TOO_LONG",
    });
    expect(ABOUT_STAT_FIELD_ERRORS.LABEL_EN_REQUIRED).toBe("labelEn");
  });
});

describe("localizedAboutStats", () => {
  const stats: AboutStat[] = [
    { id: 1, value: "12", label: "Arbitres", labelEn: "Referees" },
    { id: 2, value: "0 €", label: "Frais", labelEn: null },
  ];

  it("sous /en, seuls les chiffres traduits, dans leur anglais", () => {
    expect(localizedAboutStats(stats, "en")).toEqual([{ stat: stats[0], label: "Referees", index: 0 }]);
    expect(localizedAboutStats(stats, "fr").map((s) => s.label)).toEqual(["Arbitres", "Frais"]);
  });

  it("les chiffres de secours ont leur anglais", () => {
    expect(localizedAboutStats(FALLBACK_ABOUT_STATS, "en")).toHaveLength(FALLBACK_ABOUT_STATS.length);
  });

  it("phrase un refus d'anglais", () => {
    expect(aboutStatErrorMessage("LABEL_EN_REQUIRED", "x")).toBe("La traduction anglaise est requise.");
  });
});

