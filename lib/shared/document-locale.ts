import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/shared/locales";

/**
 * La langue du document (`<html lang>`, posée par la mise en page racine), lue
 * au moment d'un chargement à la demande ; le français hors navigateur.
 */
export function documentLocale(): Locale {
  const lang = typeof document === "undefined" ? null : document.documentElement.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}
