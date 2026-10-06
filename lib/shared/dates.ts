/**
 * Dates affichées, dans la langue de la page (`docs/features/I18N.md` § Dates,
 * nombres, pluriels).
 *
 * La langue est **facultative** et vaut le français : les écrans pas encore
 * traduits appellent ces fonctions sans elle et gardent leur rendu à l'octet
 * près. Un écran traduit passe la sienne (`useAppLocale()`, `requestLocale()`).
 */
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "./locales";

export function formatLocalDate(date: Date | string, locale: Locale = DEFAULT_LOCALE): string {
  return new Date(date).toLocaleDateString(INTL_LOCALE[locale]);
}

export function formatLocalDateTime(date: Date | string, locale: Locale = DEFAULT_LOCALE): string {
  return new Date(date).toLocaleString(INTL_LOCALE[locale]);
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
  let format = monthFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "short", timeZone: "UTC" });
    monthFormats.set(locale, format);
  }
  return format.format(new Date(Date.UTC(year, index, 15)));
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
