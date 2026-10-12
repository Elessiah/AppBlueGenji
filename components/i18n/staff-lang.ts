"use client";

import { useAppLocale } from "@/components/i18n/locale-context";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";

/**
 * Langue d'un outil du staff resté **français** (D4) sur une page traduite :
 * `"fr"` sous `/en`, à poser en `lang` (WCAG 3.1.2), en `contentLang` d'une
 * `ConfirmActionDialog` et sur ses notifications (`showError(…, { lang })`) ;
 * `undefined` sur une page française, où rien n'est à signaler.
 */
export function useStaffLang(): "fr" | undefined {
  return useAppLocale() === DEFAULT_LOCALE ? undefined : "fr";
}
