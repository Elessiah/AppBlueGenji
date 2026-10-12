/**
 * Dates affichées, dans la langue de la page (`docs/features/I18N.md` § Dates,
 * nombres, pluriels).
 *
 * La langue est **facultative** et vaut le français : les écrans pas encore
 * traduits appellent ces fonctions sans elle et gardent leur rendu à l'octet
 * près. Un écran traduit passe la sienne (`useAppLocale()`, `requestLocale()`).
 */
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "./locales";
import { cached } from "./intl-cache";

/** Ce qu'affiche une date ou une heure illisible : visible, sans langue (jamais « Invalid Date »). */
export const UNREADABLE_DATE = "—";

/**
 * L'heure d'une échéance proche (expiration d'un code), dans la langue de la
 * page ; une valeur absente ou illisible rend {@link UNREADABLE_DATE}.
 */
export function formatExpiryTime(iso: string | undefined, locale: Locale = DEFAULT_LOCALE): string {
  const date = new Date(iso ?? "");
  return Number.isNaN(date.getTime()) ? UNREADABLE_DATE : date.toLocaleTimeString(INTL_LOCALE[locale]);
}

// Formateurs gardés par langue (lot 9-1, revue performance) : un tableau
// d'historique en demandait deux par ligne et par rendu. Mêmes options que
// `toLocaleDateString` / `toLocaleString` sans argument (date ; date et heure,
// en chiffres) : le rendu ne change pas d'un octet.
const dateFormats = new Map<Locale, Intl.DateTimeFormat>();
const dateTimeFormats = new Map<Locale, Intl.DateTimeFormat>();

/**
 * `format` d'un formateur gardé, avec le repli de `toLocale*String` : une date
 * invalide y rend « Invalid Date », là où `Intl.DateTimeFormat#format` lève
 * (`RangeError`) — une seule donnée abîmée ferait tomber tout l'écran.
 */
function formatWith(format: Intl.DateTimeFormat, date: Date | string): string {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? String(value) : format.format(value);
}

export function formatLocalDate(date: Date | string, locale: Locale = DEFAULT_LOCALE): string {
  return formatWith(cached(dateFormats, locale, (l) => new Intl.DateTimeFormat(INTL_LOCALE[l])), date);
}

export function formatLocalDateTime(date: Date | string, locale: Locale = DEFAULT_LOCALE): string {
  return formatWith(
    cached(
      dateTimeFormats,
      locale,
      (l) =>
        new Intl.DateTimeFormat(INTL_LOCALE[l], {
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        }),
    ),
    date,
  );
}

const monthFormats = new Map<Locale, Intl.DateTimeFormat>();

/**
 * Mois abrégé d'une clé `YYYY-MM` (`"2026-03"` → « mars » / « Mar »), ou la
 * clé telle quelle si elle n'en est pas une. Lu en temps universel, comme la
 * clé (`monthKey`) : le fuseau du lecteur ne décale jamais d'un mois.
 */
export function shortMonthLabel(month: string, locale: Locale = DEFAULT_LOCALE): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  if (!/^\d{4}-\d{2}$/.test(month) || index < 0 || index > 11) return month;
  const format = cached(monthFormats, locale, (l) => new Intl.DateTimeFormat(INTL_LOCALE[l], { month: "short", timeZone: "UTC" }));
  return format.format(new Date(Date.UTC(year, index, 15)));
}

const monthYearFormats = new Map<Locale, Intl.DateTimeFormat>();

/**
 * Mois abrégé et année (« mars 2026 » / « Mar 2026 »), à l'heure du lecteur —
 * `toLocaleDateString(langue, { month: "short", year: "numeric" })`, le
 * formateur gardé d'un appel à l'autre (une grille de cartes le demandait à
 * chaque carte et chaque frappe).
 */
export function formatMonthYear(date: Date | string, locale: Locale = DEFAULT_LOCALE): string {
  return formatWith(
    cached(monthYearFormats, locale, (l) => new Intl.DateTimeFormat(INTL_LOCALE[l], { month: "short", year: "numeric" })),
    date,
  );
}

const collators = new Map<Locale, Intl.Collator>();

/**
 * Comparateur de noms dans la langue de la page, pour `Array.sort` : un
 * `Intl.Collator` gardé par langue plutôt que `localeCompare(b, langue)`, qui
 * en résout un à chaque comparaison.
 */
export function compareLocalText(locale: Locale = DEFAULT_LOCALE): (a: string, b: string) => number {
  return cached(collators, locale, (l) => new Intl.Collator(INTL_LOCALE[l])).compare;
}

/** Nombre dans la langue de la page (`1 500` / `1,500`, `1,5` / `1.5`). */
export function formatLocalNumber(value: number, locale: Locale = DEFAULT_LOCALE): string {
  return value.toLocaleString(INTL_LOCALE[locale]);
}

export function localDateTimeInput(hoursFromNow: number): string {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}
