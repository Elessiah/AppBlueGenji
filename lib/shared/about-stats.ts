import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import {
  checkEnglish,
  englishCodes,
  englishErrorMessage,
  englishOrNull,
  hasEnglish,
  staffText,
} from "@/lib/shared/staff-translation";
import { withoutInvisibles } from "@/lib/shared/visible-text";

export type AboutStat = {
  id: number;
  value: string;
  /**
   * Valeur écrite à l'anglaise (« €4,200 », « Free ») ; facultative : `null`
   * reprend la valeur française sous `/en` (un « 12 » n'a rien à traduire).
   */
  valueEn: string | null;
  label: string;
  /** Titre en anglais (lot 5b) ; `null` tant qu'il n'est pas saisi — la carte n'est alors pas rendue sous `/en`. */
  labelEn: string | null;
};

export type AboutStatInput = {
  value: string;
  /** `undefined` (clé absente d'une mise à jour) : l'anglais enregistré est conservé ; `null` ou vide l'efface. */
  valueEn?: string | null;
  label: string;
  labelEn?: string | null;
};

/**
 * Cartes affichées sous le titre « L'association » tant qu'aucune ligne n'existe
 * en base (ou si la base est injoignable). Les `id` négatifs marquent ces cartes
 * « de secours » comme non modifiables côté interface. Partagé client/serveur.
 */
export const FALLBACK_ABOUT_STATS: AboutStat[] = [
  { id: -1, value: "100%", valueEn: "100%", label: "Bénévole", labelEn: "Volunteer-run" },
  { id: -2, value: "€4 200", valueEn: "€4,200", label: "Prizepool 2025", labelEn: "2025 prize pool" },
  { id: -3, value: "12", valueEn: "12", label: "Arbitres", labelEn: "Referees" },
  { id: -4, value: "0 €", valueEn: "€0", label: "Frais d'inscription", labelEn: "Entry fee" },
];

export const ABOUT_STAT_VALUE_MAX = 40;
export const ABOUT_STAT_LABEL_MAX = 60;

export type AboutStatValidationResult =
  | { ok: true; value: { value: string; valueEn: string | null; label: string; labelEn: string } }
  | { ok: false; error: string };

/**
 * Champ saisi sans ce qui ne se voit pas (`withoutInvisibles`) : une valeur
 * faite seulement d'invisibles ou de commandes de direction (U+200B, U+202E)
 * est donc **vide** — refusée en français, absente en anglais (la marque EN et
 * l'avertissement restent justes). Sans NFKC : « 4 200 € » et « m² » gardent
 * leur typographie. Tout ce qui n'est pas du texte reste tel quel, pour les
 * refus existants.
 */
function cleanField(raw: unknown): unknown {
  return typeof raw === "string" ? withoutInvisibles(raw) : raw;
}

/**
 * Valide et normalise une carte (valeur + titre). Les deux champs sont requis ;
 * la valeur anglaise est facultative (rognée, vide → `null`).
 */
export function validateAboutStatInput(input: AboutStatInput): AboutStatValidationResult {
  const cleanValue = cleanField(input.value);
  const cleanLabel = cleanField(input.label);
  const value = typeof cleanValue === "string" ? cleanValue : "";
  const label = typeof cleanLabel === "string" ? cleanLabel : "";

  if (!value) return { ok: false, error: "VALUE_REQUIRED" };
  if (value.length > ABOUT_STAT_VALUE_MAX) return { ok: false, error: "VALUE_TOO_LONG" };
  const valueEn = englishOrNull(cleanField(input.valueEn));
  if (valueEn !== null && valueEn.length > ABOUT_STAT_VALUE_MAX) return { ok: false, error: "VALUE_EN_TOO_LONG" };
  if (!label) return { ok: false, error: "LABEL_REQUIRED" };
  if (label.length > ABOUT_STAT_LABEL_MAX) return { ok: false, error: "LABEL_TOO_LONG" };
  const labelEn = checkEnglish(cleanField(input.labelEn), true, ABOUT_STAT_LABEL_MAX, englishCodes("LABEL"));
  if (!labelEn.ok) return labelEn;

  return { ok: true, value: { value, valueEn, label, labelEn: labelEn.value ?? "" } };
}

/**
 * La valeur d'un chiffre dans la langue de la page : la française en
 * français ; sous `/en`, l'anglaise si elle est saisie, sinon la française.
 */
export function aboutStatValue(stat: Pick<AboutStat, "value" | "valueEn">, locale: Locale): string {
  if (locale !== DEFAULT_LOCALE && hasEnglish(stat.valueEn)) return stat.valueEn.trim();
  return stat.value;
}

/**
 * Sous `/en`, la valeur affichée est-elle du français ? Seulement sans anglais
 * saisi **et** quand elle porte des lettres : « 12 » ou « 100% » se lisent
 * aussi bien en anglais, un `lang="fr"` les ferait prononcer en français.
 */
export function aboutStatValueIsFrench(stat: Pick<AboutStat, "value" | "valueEn">, locale: Locale): boolean {
  return locale !== DEFAULT_LOCALE && !hasEnglish(stat.valueEn) && /\p{L}/u.test(stat.value);
}

/**
 * Écriture propre au français dans une valeur : groupe de milliers espacé
 * (« 4 200 », espace fine comprise), virgule décimale (« 1,5 », pas « 1,000 »),
 * euro en suffixe (« 0 € ») ou espace avant « % » (« 100 % »).
 */
const FRENCH_NUMBER_FORMAT = /\d[ \u00a0\u2009\u202f]\d{3}(?!\d)|\d,(?!\d{3}(?!\d))\d|\d\s*€|\d\s+%/u;

/**
 * La valeur attend-elle une valeur anglaise ? Sans anglais saisi, quand elle
 * porte des mots (`aboutStatValueIsFrench`) ou s'écrit à la française
 * (« 4 200 € », que la page anglaise lirait tel quel) ; « 12 », « 100% » ou
 * « €4200 » se lisent aussi bien en anglais.
 */
export function aboutStatValueNeedsEnglish(stat: Pick<AboutStat, "value" | "valueEn">): boolean {
  return !hasEnglish(stat.valueEn) && (/\p{L}/u.test(stat.value) || FRENCH_NUMBER_FORMAT.test(stat.value));
}

/**
 * La carte attend-elle encore de l'anglais ? Sans titre anglais, elle n'est pas
 * rendue sous `/en` ; sans valeur anglaise, une valeur faite de mots ou écrite
 * à la française s'y lit telle quelle (`aboutStatValueNeedsEnglish`). Les deux
 * se signalent au staff.
 */
export function aboutStatNeedsEnglish(stat: Pick<AboutStat, "value" | "valueEn" | "labelEn">): boolean {
  return !hasEnglish(stat.labelEn) || aboutStatValueNeedsEnglish(stat);
}

/**
 * Les chiffres dans la langue de la page, avec leur place dans la liste
 * complète (le réordonnancement porte sur elle). Sous `/en`, un chiffre sans
 * titre anglais n'est pas rendu (`staff-translation.ts`) ; sa valeur est
 * l'anglaise, ou la française à défaut (`aboutStatValue`).
 */
export function localizedAboutStats(
  stats: readonly AboutStat[],
  locale: Locale,
): { stat: AboutStat; value: string; label: string; index: number }[] {
  return stats.flatMap((stat, index) => {
    const label = staffText(stat.label, stat.labelEn, locale);
    return label === null ? [] : [{ stat, value: aboutStatValue(stat, locale), label, index }];
  });
}

/** Champ du formulaire que chaque refus désigne (`useFieldErrors`). */
export const ABOUT_STAT_FIELD_ERRORS = {
  VALUE_REQUIRED: "value",
  VALUE_TOO_LONG: "value",
  VALUE_EN_TOO_LONG: "valueEn",
  LABEL_REQUIRED: "label",
  LABEL_TOO_LONG: "label",
  LABEL_EN_REQUIRED: "labelEn",
  LABEL_EN_TOO_LONG: "labelEn",
  // Refus de lecture du corps (`bodyReadRefusal`) : rattachés au premier champ.
  PAYLOAD_TOO_LARGE: "value",
  UNSUPPORTED_CONTENT_TYPE: "value",
} as const;

const ABOUT_STAT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  VALUE_REQUIRED: "La valeur est requise.",
  VALUE_TOO_LONG: `Valeur trop longue (${ABOUT_STAT_VALUE_MAX} caractères maximum).`,
  VALUE_EN_TOO_LONG: `Valeur anglaise trop longue (${ABOUT_STAT_VALUE_MAX} caractères maximum).`,
  LABEL_REQUIRED: "Le titre est requis.",
  LABEL_TOO_LONG: `Titre trop long (${ABOUT_STAT_LABEL_MAX} caractères maximum).`,
  PAYLOAD_TOO_LARGE: "Envoi trop volumineux.",
  UNSUPPORTED_CONTENT_TYPE: "Requête refusée. Recharge la page, puis réessaie.",
};

/** Phrase d'un refus (staff, en français — D4) ; un code inconnu garde « Échec : CODE ». */
export function aboutStatErrorMessage(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback;
  if (Object.hasOwn(ABOUT_STAT_ERROR_MESSAGES, code)) return ABOUT_STAT_ERROR_MESSAGES[code];
  return englishErrorMessage(code) ?? `Échec : ${code}`;
}
