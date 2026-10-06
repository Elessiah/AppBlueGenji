import type { Locale } from "@/lib/shared/locales";
import { checkEnglish, englishCodes, englishErrorMessage, staffText } from "@/lib/shared/staff-translation";

export type AboutStat = {
  id: number;
  value: string;
  label: string;
  /** Titre en anglais (lot 5b) ; `null` tant qu'il n'est pas saisi — la carte n'est alors pas rendue sous `/en`. */
  labelEn: string | null;
};

export type AboutStatInput = {
  value: string;
  label: string;
  labelEn?: string | null;
};

/**
 * Cartes affichées sous le titre « L'association » tant qu'aucune ligne n'existe
 * en base (ou si la base est injoignable). Les `id` négatifs marquent ces cartes
 * « de secours » comme non modifiables côté interface. Partagé client/serveur.
 */
export const FALLBACK_ABOUT_STATS: AboutStat[] = [
  { id: -1, value: "100%", label: "Bénévole", labelEn: "Volunteer-run" },
  { id: -2, value: "€4 200", label: "Prizepool 2025", labelEn: "2025 prize pool" },
  { id: -3, value: "12", label: "Arbitres", labelEn: "Referees" },
  { id: -4, value: "0 €", label: "Frais d'inscription", labelEn: "Entry fee" },
];

export const ABOUT_STAT_VALUE_MAX = 40;
export const ABOUT_STAT_LABEL_MAX = 60;

export type AboutStatValidationResult =
  | { ok: true; value: { value: string; label: string; labelEn: string } }
  | { ok: false; error: string };

/** Valide et normalise une carte (valeur + titre). Les deux champs sont requis. */
export function validateAboutStatInput(input: AboutStatInput): AboutStatValidationResult {
  const value = typeof input.value === "string" ? input.value.trim() : "";
  const label = typeof input.label === "string" ? input.label.trim() : "";

  if (!value) return { ok: false, error: "VALUE_REQUIRED" };
  if (value.length > ABOUT_STAT_VALUE_MAX) return { ok: false, error: "VALUE_TOO_LONG" };
  if (!label) return { ok: false, error: "LABEL_REQUIRED" };
  if (label.length > ABOUT_STAT_LABEL_MAX) return { ok: false, error: "LABEL_TOO_LONG" };
  const labelEn = checkEnglish(input.labelEn, true, ABOUT_STAT_LABEL_MAX, englishCodes("LABEL"));
  if (!labelEn.ok) return labelEn;

  return { ok: true, value: { value, label, labelEn: labelEn.value ?? "" } };
}

/**
 * Les chiffres dans la langue de la page, avec leur place dans la liste
 * complète (le réordonnancement porte sur elle). Sous `/en`, un chiffre sans
 * titre anglais n'est pas rendu (`staff-translation.ts`).
 */
export function localizedAboutStats(
  stats: readonly AboutStat[],
  locale: Locale,
): { stat: AboutStat; label: string; index: number }[] {
  return stats.flatMap((stat, index) => {
    const label = staffText(stat.label, stat.labelEn, locale);
    return label === null ? [] : [{ stat, label, index }];
  });
}

/** Champ du formulaire que chaque refus désigne (`useFieldErrors`). */
export const ABOUT_STAT_FIELD_ERRORS = {
  VALUE_REQUIRED: "value",
  VALUE_TOO_LONG: "value",
  LABEL_REQUIRED: "label",
  LABEL_TOO_LONG: "label",
  LABEL_EN_REQUIRED: "labelEn",
  LABEL_EN_TOO_LONG: "labelEn",
} as const;

const ABOUT_STAT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  VALUE_REQUIRED: "La valeur est requise.",
  VALUE_TOO_LONG: `Valeur trop longue (${ABOUT_STAT_VALUE_MAX} caractères maximum).`,
  LABEL_REQUIRED: "Le titre est requis.",
  LABEL_TOO_LONG: `Titre trop long (${ABOUT_STAT_LABEL_MAX} caractères maximum).`,
};

/** Phrase d'un refus (staff, en français — D4) ; un code inconnu garde « Échec : CODE ». */
export function aboutStatErrorMessage(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback;
  if (Object.hasOwn(ABOUT_STAT_ERROR_MESSAGES, code)) return ABOUT_STAT_ERROR_MESSAGES[code];
  return englishErrorMessage(code) ?? `Échec : ${code}`;
}
