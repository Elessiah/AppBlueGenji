/**
 * Lot 9-1, revue performance — `formatMonthYear` et `compareLocalText` gardent
 * leur formateur par langue, au même rendu que les appels qu'ils remplacent
 * (`toLocaleDateString(…, { month: "short", year: "numeric" })`,
 * `localeCompare(b, langue)`).
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UNREADABLE_DATE, compareLocalText, formatExpiryTime, formatLocalDate, formatLocalDateTime, formatMonthYear } from "@/lib/shared/dates";
import { cached } from "@/lib/shared/intl-cache";
import { ordinalForm } from "@/lib/shared/ordinal";
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

describe("formatLocalDate / formatLocalDateTime gardés", () => {
  it.each(LOCALES)("%s : même rendu que toLocaleDateString / toLocaleString", (locale) => {
    for (const date of DATES) {
      expect(formatLocalDate(date, locale)).toBe(new Date(date).toLocaleDateString(INTL_LOCALE[locale]));
      expect(formatLocalDateTime(date, locale)).toBe(new Date(date).toLocaleString(INTL_LOCALE[locale]));
      expect(formatLocalDate(new Date(date), locale)).toBe(formatLocalDate(date, locale));
    }
  });

  it("français par défaut, sans nouveau formateur une fois chaud", () => {
    expect(formatLocalDate(DATES[0])).toBe(formatLocalDate(DATES[0], "fr"));
    expect(formatLocalDateTime(DATES[0])).toBe(formatLocalDateTime(DATES[0], "fr"));
    formatLocalDate(DATES[0], "en");
    formatLocalDateTime(DATES[0], "en");
    const spy = jest.spyOn(Intl, "DateTimeFormat");
    for (const date of DATES) {
      formatLocalDate(date, "en");
      formatLocalDateTime(date, "fr");
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("cached", () => {
  it("construit une fois par clé", () => {
    const cache = new Map<string, { key: string }>();
    const create = jest.fn((key: string) => ({ key }));
    const first = cached(cache, "fr", create);
    expect(cached(cache, "fr", create)).toBe(first);
    expect(cached(cache, "en", create)).toEqual({ key: "en" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("ordinalForm garde ses règles", () => {
    ordinalForm("en", 1);
    const spy = jest.spyOn(Intl, "PluralRules");
    expect([1, 2, 3, 4, 11, 21].map((n) => ordinalForm("en", n))).toEqual(["one", "two", "few", "other", "other", "one"]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("modules légers", () => {
  // `dates.ts` et `ordinal.ts` sont lus par de nombreux écrans : le cache vit
  // dans un module neutre, pas dans l'analyseur de messages.
  it.each(["lib/shared/dates.ts", "lib/shared/ordinal.ts"])("%s n'importe pas message-format", (path) => {
    const code = readFileSync(join(__dirname, "..", "..", "..", path), "utf8");
    expect(code).not.toMatch(/from "[^"]*message-format"/);
    expect(code).toMatch(/from "[^"]*intl-cache"/);
  });
});

describe("date invalide : le repli de toLocale*String, jamais une exception", () => {
  it.each(LOCALES)("%s", (locale) => {
    for (const bad of ["", "pas une date", new Date(Number.NaN)]) {
      expect(formatLocalDate(bad, locale)).toBe(new Date(bad).toLocaleDateString(INTL_LOCALE[locale]));
      expect(formatLocalDateTime(bad, locale)).toBe(new Date(bad).toLocaleString(INTL_LOCALE[locale]));
      expect(formatMonthYear(bad, locale)).toBe(
        new Date(bad).toLocaleDateString(INTL_LOCALE[locale], { month: "short", year: "numeric" }),
      );
      expect(formatLocalDate(bad, locale)).toBe("Invalid Date");
    }
  });
});

describe("formatExpiryTime (revue de sécurité du lot 9-2)", () => {
  it("heure dans la langue de la page, comme toLocaleTimeString", () => {
    const iso = "2026-03-15T12:34:00.000Z";
    for (const locale of LOCALES) {
      expect(formatExpiryTime(iso, locale)).toBe(new Date(iso).toLocaleTimeString(INTL_LOCALE[locale]));
    }
  });

  it("absente ou illisible : un tiret, jamais « Invalid Date »", () => {
    expect(formatExpiryTime(undefined)).toBe(UNREADABLE_DATE);
    expect(formatExpiryTime("pas une heure", "en")).toBe("—");
  });
});
