import type { Locale } from "@/lib/shared/locales";
import { checkEnglish, englishCodes, englishErrorMessage, staffText } from "@/lib/shared/staff-translation";

export type AboutPillar = {
  id: number;
  title: string;
  text: string;
  /** Titre et texte en anglais (lot 5b) ; `null` tant qu'ils ne sont pas saisis — la carte n'est alors pas rendue sous `/en`. */
  titleEn: string | null;
  textEn: string | null;
};

export type AboutPillarInput = {
  title: string;
  text: string;
  titleEn?: string | null;
  textEn?: string | null;
};

/**
 * Piliers affichés à droite de la SECTION 03 tant qu'aucune ligne n'existe en
 * base (ou si la base est injoignable). Les `id` négatifs marquent ces cartes
 * « de secours » comme non modifiables côté interface. Partagé client/serveur.
 */
export const FALLBACK_ABOUT_PILLARS: AboutPillar[] = [
  {
    id: -1,
    title: "Accessible",
    text: "Inscription gratuite, ouverte à tous les niveaux, et support francophone sur Discord.",
    titleEn: "Accessible",
    textEn: "Free registration, open to every skill level, with French-speaking support on Discord.",
  },
  {
    id: -2,
    title: "Compétitif",
    text: "Tableaux arbitrés, admins formés et règlement clair pour chaque format. On prend le jeu au sérieux.",
    titleEn: "Competitive",
    textEn: "Refereed brackets, trained admins and clear rules for every format. We take the game seriously.",
  },
  {
    id: -3,
    title: "Communautaire",
    text: "Discord actif, coaching ouvert et entraide entre équipes. L'asso avant le classement.",
    titleEn: "Community-driven",
    textEn: "An active Discord, open coaching and teams helping each other. The association comes before the ranking.",
  },
];

export const ABOUT_PILLAR_TITLE_MAX = 60;
export const ABOUT_PILLAR_TEXT_MAX = 240;

export type AboutPillarValidationResult =
  | { ok: true; value: { title: string; text: string; titleEn: string; textEn: string } }
  | { ok: false; error: string };

/** Valide et normalise un pilier (titre + texte). Les deux champs sont requis. */
export function validateAboutPillarInput(input: AboutPillarInput): AboutPillarValidationResult {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";

  if (!title) return { ok: false, error: "TITLE_REQUIRED" };
  if (title.length > ABOUT_PILLAR_TITLE_MAX) return { ok: false, error: "TITLE_TOO_LONG" };
  if (!text) return { ok: false, error: "TEXT_REQUIRED" };
  if (text.length > ABOUT_PILLAR_TEXT_MAX) return { ok: false, error: "TEXT_TOO_LONG" };
  const titleEn = checkEnglish(input.titleEn, true, ABOUT_PILLAR_TITLE_MAX, englishCodes("TITLE"));
  if (!titleEn.ok) return titleEn;
  const textEn = checkEnglish(input.textEn, true, ABOUT_PILLAR_TEXT_MAX, englishCodes("TEXT"));
  if (!textEn.ok) return textEn;

  return { ok: true, value: { title, text, titleEn: titleEn.value ?? "", textEn: textEn.value ?? "" } };
}

/**
 * Les cartes « À propos » dans la langue de la page, avec leur place dans la
 * liste complète. Sous `/en`, une carte sans titre **et** texte anglais n'est
 * pas rendue (`staff-translation.ts`).
 */
export function localizedAboutPillars(
  pillars: readonly AboutPillar[],
  locale: Locale,
): { pillar: AboutPillar; title: string; text: string; index: number }[] {
  return pillars.flatMap((pillar, index) => {
    const title = staffText(pillar.title, pillar.titleEn, locale);
    const text = staffText(pillar.text, pillar.textEn, locale);
    return title === null || text === null ? [] : [{ pillar, title, text, index }];
  });
}

/** La carte a-t-elle tout son anglais ? */
export function aboutPillarHasEnglish(pillar: Pick<AboutPillar, "title" | "text" | "titleEn" | "textEn">): boolean {
  return staffText(pillar.title, pillar.titleEn, "en") !== null && staffText(pillar.text, pillar.textEn, "en") !== null;
}

/** Champ du formulaire que chaque refus désigne (`useFieldErrors`). */
export const ABOUT_PILLAR_FIELD_ERRORS = {
  TITLE_REQUIRED: "title",
  TITLE_TOO_LONG: "title",
  TITLE_EN_REQUIRED: "titleEn",
  TITLE_EN_TOO_LONG: "titleEn",
  TEXT_REQUIRED: "text",
  TEXT_TOO_LONG: "text",
  TEXT_EN_REQUIRED: "textEn",
  TEXT_EN_TOO_LONG: "textEn",
} as const;

const ABOUT_PILLAR_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  TITLE_REQUIRED: "Le titre est requis.",
  TITLE_TOO_LONG: `Titre trop long (${ABOUT_PILLAR_TITLE_MAX} caractères maximum).`,
  TEXT_REQUIRED: "Le texte est requis.",
  TEXT_TOO_LONG: `Texte trop long (${ABOUT_PILLAR_TEXT_MAX} caractères maximum).`,
};

/** Phrase d'un refus (staff, en français — D4) ; un code inconnu garde « Échec : CODE ». */
export function aboutPillarErrorMessage(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback;
  if (Object.hasOwn(ABOUT_PILLAR_ERROR_MESSAGES, code)) return ABOUT_PILLAR_ERROR_MESSAGES[code];
  return englishErrorMessage(code) ?? `Échec : ${code}`;
}
