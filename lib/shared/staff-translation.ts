/**
 * Contenus saisis par le staff sur les pages de l'association (bureau,
 * bénévoles, chiffres et cartes « À propos », description d'un partenaire,
 * annonces de recrutement) : **une valeur par langue**, l'anglais obligatoire à
 * la saisie — D9 de `docs/features/I18N_MIGRATION_PLAN.md`, même règle que les
 * textes éditables (`site-copy.ts`, lot 2), lot 5b.
 *
 * Le français reste la colonne d'origine ; l'anglais vit dans une colonne
 * `<colonne>_en`, `NULL` tant que personne ne l'a saisi. Les lignes écrites
 * avant le lot 5b n'ont donc pas d'anglais : **sous `/en`, elles ne sont pas
 * rendues** (décision du 2026-10-06, comme au lot 2) — jamais de français sur
 * une page anglaise —, et leur éditeur porte la marque **EN** jusqu'à ce qu'un
 * porteur de `showcase` la remplisse (`EDITABLE_SITE_COPY.md` § Rattrapage).
 *
 * Module pur, partagé : les validations du client et du serveur en dépendent.
 */
import { SITE_COPY_ERROR_MESSAGES } from "@/lib/shared/site-copy";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";

/** Une saisie anglaise réduite : texte rogné, `null` si vide. */
export function englishOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Le contenu a-t-il son anglais ? */
export function hasEnglish(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Le texte d'un contenu dans la langue de la page : le français en français ;
 * l'anglais saisi sous `/en`, ou `null` — le contenu n'est alors **pas rendu**.
 */
export function staffText(fr: string, en: string | null | undefined, locale: Locale): string | null {
  if (locale === DEFAULT_LOCALE) return fr;
  return hasEnglish(en) ? en.trim() : null;
}

/**
 * Comme {@link staffText} pour un champ **facultatif** : un français vide n'a
 * rien à traduire (`""`) ; un français saisi sans anglais rend `null`.
 */
export function optionalStaffText(
  fr: string | null | undefined,
  en: string | null | undefined,
  locale: Locale,
): string | null {
  if (!fr || !fr.trim()) return "";
  return staffText(fr, en, locale);
}

/** Codes de refus d'un champ anglais, par champ (`ROLE_EN_REQUIRED`, `ROLE_EN_TOO_LONG`). */
export type EnglishCodes = Readonly<{ required: string; tooLong: string }>;

export function englishCodes(field: string): EnglishCodes {
  return { required: `${field}_EN_REQUIRED`, tooLong: `${field}_EN_TOO_LONG` };
}

export type EnglishCheck = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Valide l'anglais d'un champ. `frPresent` : le français est saisi — l'anglais
 * est alors **obligatoire** ; sans français (champ facultatif laissé vide),
 * l'anglais est ignoré (`null`) : il traduirait un texte qui n'existe pas.
 */
export function checkEnglish(value: unknown, frPresent: boolean, max: number, codes: EnglishCodes): EnglishCheck {
  if (!frPresent) return { ok: true, value: null };
  const en = englishOrNull(value);
  if (en === null) return { ok: false, error: codes.required };
  if (en.length > max) return { ok: false, error: codes.tooLong };
  return { ok: true, value: en };
}

/**
 * Phrase (staff, en français — l'administration n'est pas traduite, D4) d'un
 * refus d'anglais, reprise de l'éditeur des textes de la vitrine ; `null` pour
 * tout autre code.
 */
export function englishErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code.endsWith("_EN_REQUIRED")) return SITE_COPY_ERROR_MESSAGES.COPY_EN_EMPTY;
  if (code.endsWith("_EN_TOO_LONG")) return SITE_COPY_ERROR_MESSAGES.COPY_EN_TOO_LONG;
  return null;
}

/** Aide sous un champ anglais vide d'un contenu déjà en ligne (rattrapage). */
export const ENGLISH_BACKFILL_HINT =
  "Pas encore de traduction : ce contenu n'apparaît pas sur la page anglaise. Traduis le texte français.";
