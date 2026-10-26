import { describe, expect, it } from "@jest/globals";
import {
  ABOUT_STAT_FIELD_ERRORS,
  ABOUT_STAT_LABEL_MAX,
  ABOUT_STAT_VALUE_MAX,
  FALLBACK_ABOUT_STATS,
  aboutStatErrorMessage,
  aboutStatValue,
  aboutStatNeedsEnglish,
  aboutStatValueIsFrench,
  aboutStatValueNeedsEnglish,
  localizedAboutStats,
  validateAboutStatInput,
  type AboutStat,
} from "@/lib/shared/about-stats";

describe("validateAboutStatInput", () => {
  it("accepts a valid input", () => {
    const result = validateAboutStatInput({ labelEn: "Label", value: "100%", label: "Bénévole" });
    expect(result).toEqual({ ok: true, value: { value: "100%", valueEn: null, label: "Bénévole", labelEn: "Label" } });
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

describe("validateAboutStatInput — valeur anglaise (facultative)", () => {
  const base = { value: "€4 200", label: "Prizepool", labelEn: "Prize pool" };

  it("rogne la valeur anglaise", () => {
    const result = validateAboutStatInput({ ...base, valueEn: "  €4,200  " });
    expect(result).toEqual({
      ok: true,
      value: { value: "€4 200", valueEn: "€4,200", label: "Prizepool", labelEn: "Prize pool" },
    });
  });

  it("vide, absente ou non textuelle → null", () => {
    for (const valueEn of ["", "   ", null, undefined, 42 as unknown as string]) {
      const result = validateAboutStatInput({ ...base, valueEn });
      expect(result.ok && result.value.valueEn).toBeNull();
    }
  });

  it("accepte la longueur maximale, refuse au-delà", () => {
    const max = validateAboutStatInput({ ...base, valueEn: "v".repeat(ABOUT_STAT_VALUE_MAX) });
    expect(max.ok && max.value.valueEn).toHaveLength(ABOUT_STAT_VALUE_MAX);
    expect(validateAboutStatInput({ ...base, valueEn: "v".repeat(ABOUT_STAT_VALUE_MAX + 1) })).toEqual({
      ok: false,
      error: "VALUE_EN_TOO_LONG",
    });
  });

  it("une valeur française absente prime sur l'anglaise", () => {
    expect(validateAboutStatInput({ ...base, value: "", valueEn: "€0" })).toEqual({ ok: false, error: "VALUE_REQUIRED" });
  });

  it("désigne son champ et a sa phrase", () => {
    expect(ABOUT_STAT_FIELD_ERRORS.VALUE_EN_TOO_LONG).toBe("valueEn");
    expect(aboutStatErrorMessage("VALUE_EN_TOO_LONG", "x")).toBe(
      `Valeur anglaise trop longue (${ABOUT_STAT_VALUE_MAX} caractères maximum).`,
    );
  });
});

describe("localizedAboutStats", () => {
  const stats: AboutStat[] = [
    { id: 1, value: "12", valueEn: null, label: "Arbitres", labelEn: "Referees" },
    { id: 2, value: "0 €", valueEn: "Free", label: "Frais", labelEn: null },
    { id: 3, value: "€4 200", valueEn: "€4,200", label: "Prizepool", labelEn: "Prize pool" },
  ];

  it("sous /en, seuls les chiffres traduits, dans leur anglais", () => {
    expect(localizedAboutStats(stats, "en")).toEqual([
      { stat: stats[0], value: "12", label: "Referees", index: 0 },
      { stat: stats[2], value: "€4,200", label: "Prize pool", index: 2 },
    ]);
    expect(localizedAboutStats(stats, "fr").map((s) => s.label)).toEqual(["Arbitres", "Frais", "Prizepool"]);
  });

  it("en français, toujours la valeur française", () => {
    expect(localizedAboutStats(stats, "fr").map((s) => s.value)).toEqual(["12", "0 €", "€4 200"]);
  });

  it("sous /en, la valeur anglaise, ou la française à défaut", () => {
    expect(aboutStatValue({ value: "12", valueEn: null }, "en")).toBe("12");
    expect(aboutStatValue({ value: "12", valueEn: "   " }, "en")).toBe("12");
    expect(aboutStatValue({ value: "0 €", valueEn: " €0 " }, "en")).toBe("€0");
    expect(aboutStatValue({ value: "0 €", valueEn: "€0" }, "fr")).toBe("0 €");
  });

  it("les chiffres de secours ont leur anglais, valeurs à l'anglaise", () => {
    const en = localizedAboutStats(FALLBACK_ABOUT_STATS, "en");
    expect(en).toHaveLength(FALLBACK_ABOUT_STATS.length);
    expect(en.map((s) => s.value)).toEqual(["100%", "€4,200", "12", "€0"]);
    expect(localizedAboutStats(FALLBACK_ABOUT_STATS, "fr").map((s) => s.value)).toEqual(["100%", "€4 200", "12", "0 €"]);
  });

  it("phrase un refus d'anglais", () => {
    expect(aboutStatErrorMessage("LABEL_EN_REQUIRED", "x")).toBe("La traduction anglaise est requise.");
  });

  it("sous /en, seule une valeur sans anglais qui porte des lettres est marquée française", () => {
    expect(aboutStatValueIsFrench({ value: "Gratuit", valueEn: null }, "en")).toBe(true);
    expect(aboutStatValueIsFrench({ value: "4 200 €", valueEn: "" }, "en")).toBe(false);
    expect(aboutStatValueIsFrench({ value: "12", valueEn: null }, "en")).toBe(false);
    expect(aboutStatValueIsFrench({ value: "100%", valueEn: null }, "en")).toBe(false);
    expect(aboutStatValueIsFrench({ value: "Gratuit", valueEn: "Free" }, "en")).toBe(false);
    expect(aboutStatValueIsFrench({ value: "Gratuit", valueEn: null }, "fr")).toBe(false);
  });

  it("signale au staff une carte sans titre anglais, ou dont la valeur en mots n'a pas d'anglais", () => {
    expect(aboutStatNeedsEnglish({ value: "12", valueEn: null, labelEn: null })).toBe(true);
    expect(aboutStatNeedsEnglish({ value: "Gratuit", valueEn: null, labelEn: "Entry fee" })).toBe(true);
    expect(aboutStatNeedsEnglish({ value: "Gratuit", valueEn: "  ", labelEn: "Entry fee" })).toBe(true);
    expect(aboutStatNeedsEnglish({ value: "Gratuit", valueEn: "Free", labelEn: "Entry fee" })).toBe(false);
    expect(aboutStatNeedsEnglish({ value: "100%", valueEn: null, labelEn: "Volunteer-run" })).toBe(false);
    expect(aboutStatNeedsEnglish({ value: "4 200 €", valueEn: null, labelEn: "Prize pool" })).toBe(true);
    expect(aboutStatNeedsEnglish({ value: "4 200 €", valueEn: "€4,200", labelEn: "Prize pool" })).toBe(false);
  });

  it("une valeur écrite à la française attend son anglais, même sans lettre", () => {
    for (const value of ["4 200 €", "€4 200", "4 200", "4 200", "0 €", "1,5", "1,50", "10 000 000"]) {
      expect(aboutStatValueNeedsEnglish({ value, valueEn: null })).toBe(true);
    }
    for (const value of ["12", "100%", "€4200", "€4,200", "€1,000", "2026"]) {
      expect(aboutStatValueNeedsEnglish({ value, valueEn: null })).toBe(false);
    }
    expect(aboutStatValueNeedsEnglish({ value: "Gratuit", valueEn: "" })).toBe(true);
    expect(aboutStatValueNeedsEnglish({ value: "0 €", valueEn: "Free" })).toBe(false);
    // Le lang="fr" reste réservé aux mots : « 4 200 € » se lit sans voix française.
    expect(aboutStatValueIsFrench({ value: "4 200 €", valueEn: null }, "en")).toBe(false);
  });
});
