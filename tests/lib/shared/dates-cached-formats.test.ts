/**
 * Lot 9-1, revue performance — `formatMonthYear` et `compareLocalText` gardent
 * leur formateur par langue, au même rendu que les appels qu'ils remplacent
 * (`toLocaleDateString(…, { month: "short", year: "numeric" })`,
 * `localeCompare(b, langue)`).
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { compareLocalText, formatMonthYear } from "@/lib/shared/dates";
import { INTL_LOCALE, LOCALES } from "@/lib/shared/locales";

const DATES = ["2026-03-15T12:00:00.000Z", "2024-12-31T23:30:00.000Z", "2025-01-01T00:30:00.000Z"];
const NAMES = ["Zénith", "ébène", "Alpha", "alpha", "Écho", "beta", "Œuvre", "10 Kings", "2 Fast", "_under"];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("formatMonthYear", () => {
  it.each(LOCALES)("%s : même rendu que toLocaleDateString", (locale) => {
    for (const date of DATES) {
      const expected = new Date(date).toLocaleDateString(INTL_LOCALE[locale], { month: "short", year: "numeric" });
      expect(formatMonthYear(date, locale)).toBe(expected);
      expect(formatMonthYear(new Date(date), locale)).toBe(expected);
    }
  });

  it("français par défaut", () => {
    expect(formatMonthYear(DATES[0])).toBe(formatMonthYear(DATES[0], "fr"));
  });

  it("un formateur par langue, pas un par appel", () => {
    formatMonthYear(DATES[0], "fr");
    formatMonthYear(DATES[0], "en");
    const spy = jest.spyOn(Intl, "DateTimeFormat");
    for (const date of DATES) {
      formatMonthYear(date, "fr");
      formatMonthYear(date, "en");
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("compareLocalText", () => {
  it.each(LOCALES)("%s : même ordre que localeCompare", (locale) => {
    const expected = [...NAMES].sort((a, b) => a.localeCompare(b, INTL_LOCALE[locale]));
    expect([...NAMES].sort(compareLocalText(locale))).toEqual(expected);
  });

  it("égalité et sens", () => {
    const compare = compareLocalText("fr");
    expect(compare("Alpha", "Alpha")).toBe(0);
    expect(compare("Alpha", "Beta")).toBeLessThan(0);
    expect(compare("Beta", "Alpha")).toBeGreaterThan(0);
    expect(compare("", "a")).toBeLessThan(0);
  });

  it("un comparateur gardé par langue, français par défaut", () => {
    expect(compareLocalText("en")).toBe(compareLocalText("en"));
    expect(compareLocalText()).toBe(compareLocalText("fr"));
    const spy = jest.spyOn(Intl, "Collator");
    [...NAMES].sort(compareLocalText("fr"));
    expect(spy).not.toHaveBeenCalled();
  });
});
