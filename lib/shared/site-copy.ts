/**
 * Textes éditables du site vitrine (accueil, page association, en-tête du
 * classement).
 *
 * Titres, slogans et descriptions sont d'ordinaire figés dans le JSX. Ce
 * registre les sort du code : chaque entrée déclare une clé de stockage, un
 * libellé d'administration et la valeur par défaut — celle qui était écrite en
 * dur, et qui reste servie tant que personne n'a édité le texte.
 *
 * Ajouter un texte éditable = ajouter une entrée ici (français **et** anglais
 * d'origine), puis envelopper le rendu dans `<EditableCopy copyKey="…">`.
 * Chaque texte vit en deux langues (`docs/features/EDITABLE_SITE_COPY.md`).
 * Module pur : importable partout.
 */

import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";

export type SiteCopyKey =
  | "home.hero.eyebrow"
  | "home.hero.title"
  | "home.hero.lede"
  | "home.about.title"
  | "home.about.lede"
  | "home.sponsors.lede"
  | "home.join.eyebrow"
  | "home.join.title"
  | "home.join.lede"
  | "home.join.lede.member"
  | "association.hero.eyebrow"
  | "association.hero.title"
  | "association.manifesto.lede"
  | "association.membership.lede"
  | "ranking.hero.title"
  | "ranking.hero.lede";

/** Tous les textes de la vitrine, indexés par clé. */
export type SiteCopy = Record<SiteCopyKey, string>;

export type SiteCopyField = {
  key: SiteCopyKey;
  /** Page concernée, pour regrouper dans l'administration. */
  page: "Accueil" | "Association" | "Classement";
  /** Libellé affiché à l'éditeur. */
  label: string;
  /** Texte d'origine en français — servi tant que personne ne l'a édité. */
  defaultValue: string;
  /**
   * Texte d'origine en anglais (rédigé au lot 2 de la traduction, glossaire de
   * `docs/features/I18N.md`). Servi sous `/en` tant qu'aucun anglais n'a été
   * saisi — y compris pour un français édité avant le lot 2 (rattrapage,
   * `docs/features/EDITABLE_SITE_COPY.md`) : jamais de repli sur le français.
   */
  defaultValueEn: string;
  /** Texte long → zone de saisie multiligne. */
  multiline: boolean;
  maxLength: number;
};

export const SITE_COPY_FIELDS: readonly SiteCopyField[] = [
  {
    key: "home.hero.eyebrow",
    page: "Accueil",
    label: "Hero — surtitre",
    defaultValue: "ASSOCIATION ESPORT · LOI 1901",
    defaultValueEn: "ESPORTS ASSOCIATION · FRENCH NONPROFIT",
    multiline: false,
    maxLength: 80,
  },
  {
    key: "home.hero.title",
    page: "Accueil",
    label: "Hero — titre",
    defaultValue: "Organiser,\njouer,\ngagner ensemble.",
    defaultValueEn: "Organize,\nplay,\nwin together.",
    multiline: true,
    maxLength: 160,
  },
  {
    key: "home.hero.lede",
    page: "Accueil",
    label: "Hero — accroche",
    defaultValue:
      "BlueGenji fédère une scène amateur francophone avec des tournois lisibles, des brackets en direct, des arbitres bénévoles et une communauté Discord active autour d'Overwatch et Marvel Rivals.",
    defaultValueEn:
      "BlueGenji brings together a French-speaking amateur scene with clear tournaments, live brackets, volunteer referees and an active Discord community around Overwatch and Marvel Rivals.",
    multiline: true,
    maxLength: 600,
  },
  {
    key: "home.about.title",
    page: "Accueil",
    label: "Association — titre de section",
    defaultValue: "L'association",
    defaultValueEn: "The association",
    multiline: false,
    maxLength: 80,
  },
  {
    key: "home.about.lede",
    page: "Accueil",
    label: "Association — description",
    defaultValue:
      "Une structure associative à but non lucratif, gérée par des bénévoles passionnés. On organise des tournois accessibles, bien arbitrés, avec des cash prizes réinvestis dans la scène amateur française.",
    defaultValueEn:
      "A nonprofit association run by passionate volunteers. We organize accessible, well-refereed tournaments, with cash prizes reinvested in the French amateur scene.",
    multiline: true,
    maxLength: 600,
  },
  {
    key: "home.sponsors.lede",
    page: "Accueil",
    label: "Partenaires — introduction",
    defaultValue:
      "Ils soutiennent l'association : leur aide finance les cash prizes, l'organisation et la diffusion de nos tournois. Merci à eux !",
    defaultValueEn:
      "They support the association: their help funds the cash prizes, the organization and the streaming of our tournaments. Thank you!",
    multiline: true,
    maxLength: 300,
  },
  {
    key: "home.join.eyebrow",
    page: "Accueil",
    label: "Appel final — surtitre",
    defaultValue: "REJOINDRE LA SCÈNE",
    defaultValueEn: "JOIN THE SCENE",
    multiline: false,
    maxLength: 80,
  },
  {
    key: "home.join.title",
    page: "Accueil",
    label: "Appel final — slogan",
    defaultValue: "Ton équipe. Notre bracket.\nLe prochain tournoi commence maintenant.",
    defaultValueEn: "Your team. Our bracket.\nThe next tournament starts now.",
    multiline: true,
    maxLength: 200,
  },
  {
    key: "home.join.lede",
    page: "Accueil",
    label: "Appel final — description",
    defaultValue:
      "Crée ton compte, monte une équipe de cinq, inscris-la. On s'occupe du reste avec des brackets, du streaming et de l'arbitrage.",
    defaultValueEn:
      "Create your account, build a team of five, register it. We take care of the rest with brackets, streaming and refereeing.",
    multiline: true,
    maxLength: 400,
  },
  {
    key: "home.join.lede.member",
    page: "Accueil",
    label: "Appel final — description (membre connecté)",
    defaultValue:
      "Monte une équipe de cinq et inscris-la au prochain tournoi. On s'occupe du reste avec des brackets, du streaming et de l'arbitrage.",
    defaultValueEn:
      "Build a team of five and register it for the next tournament. We take care of the rest with brackets, streaming and refereeing.",
    multiline: true,
    maxLength: 400,
  },
  {
    key: "association.hero.eyebrow",
    page: "Association",
    label: "Hero — surtitre",
    defaultValue: "L'ASSOCIATION · LOI 1901",
    defaultValueEn: "THE ASSOCIATION · FRENCH NONPROFIT",
    multiline: false,
    maxLength: 80,
  },
  {
    key: "association.hero.title",
    page: "Association",
    label: "Hero — titre",
    defaultValue: "Au service de la scène\namateur française.",
    defaultValueEn: "Serving the French\namateur scene.",
    multiline: true,
    maxLength: 160,
  },
  {
    key: "association.manifesto.lede",
    page: "Association",
    label: "Manifeste — accroche",
    defaultValue:
      "BlueGenji est née de la conviction que l'esport amateur mérite une scène fiable, ouverte et sérieuse — où chacun trouve sa place, quel que soit son niveau.",
    defaultValueEn:
      "BlueGenji was born from the belief that amateur esports deserves a reliable, open and serious scene — where everyone finds their place, whatever their level.",
    multiline: true,
    maxLength: 600,
  },
  {
    key: "association.membership.lede",
    page: "Association",
    label: "Adhérer — accroche",
    defaultValue:
      "L'adhésion fait de vous un membre de l'association. Elle se demande par le bulletin d'adhésion, à partir de 16 ans, pour un an, et reste soumise à l'agrément du bureau.",
    defaultValueEn:
      "Membership makes you a member of the association. You apply with the membership form, from age 16, for one year, subject to the board's approval.",
    multiline: true,
    maxLength: 400,
  },
  {
    key: "ranking.hero.title",
    page: "Classement",
    label: "En-tête — titre",
    defaultValue: "Grimpe jusqu'au\nsommet.",
    defaultValueEn: "Climb all the way\nto the top.",
    multiline: true,
    maxLength: 160,
  },
  {
    key: "ranking.hero.lede",
    page: "Classement",
    label: "En-tête — sous-titre",
    defaultValue:
      "Chaque match compte. Battre plus fort que soi rapporte gros, aller loin en tournoi aussi — la cote de chaque équipe raconte sa saison.",
    defaultValueEn:
      "Every match counts. Beating stronger teams pays off big, and so does going far in a tournament — each team's rating tells the story of its season.",
    multiline: true,
    maxLength: 400,
  },
];

const FIELD_BY_KEY = new Map<string, SiteCopyField>(
  SITE_COPY_FIELDS.map((field) => [field.key, field]),
);

/** Vrai si `value` est une clé de texte connue. */
export function isSiteCopyKey(value: unknown): value is SiteCopyKey {
  return typeof value === "string" && FIELD_BY_KEY.has(value);
}

/** Champ correspondant à une clé, ou `undefined` si la clé est inconnue. */
export function siteCopyField(key: string): SiteCopyField | undefined {
  return FIELD_BY_KEY.get(key);
}

/** Valeurs par défaut, servies tant qu'aucune édition n'a été enregistrée. */
export function defaultSiteCopy(locale: Locale = DEFAULT_LOCALE): Record<SiteCopyKey, string> {
  return Object.fromEntries(
    SITE_COPY_FIELDS.map((field) => [field.key, locale === "en" ? field.defaultValueEn : field.defaultValue]),
  ) as Record<SiteCopyKey, string>;
}

export type SiteCopyError =
  | "UNKNOWN_COPY_KEY"
  | "COPY_EMPTY"
  | "COPY_TOO_LONG"
  | "COPY_EN_EMPTY"
  | "COPY_EN_TOO_LONG";

export type SiteCopyValidation =
  | { ok: true; value: string }
  | { ok: false; error: "UNKNOWN_COPY_KEY" | "COPY_EMPTY" | "COPY_TOO_LONG" };

/** Texte saisi, fins de ligne normalisées (`\r\n` → `\n`) et bords rognés. */
function normalizeCopy(rawValue: unknown): string {
  // Un corps JSON peut porter n'importe quoi : seul un texte en est un. Un objet,
  // un tableau ou un booléen comptent pour vide (`String({})` donnerait
  // « [object Object] », qui passerait le contrôle de longueur).
  if (typeof rawValue !== "string") return "";
  return rawValue.replace(/\r\n/g, "\n").trim();
}

/**
 * Valide une édition. Un texte vide est refusé : vider un titre casserait la
 * page sans que l'éditeur puisse revenir en arrière autrement qu'en le
 * retapant. Les fins de ligne sont normalisées (`\r\n` → `\n`).
 */
export function validateSiteCopy(key: string, rawValue: unknown): SiteCopyValidation {
  const field = FIELD_BY_KEY.get(key);
  if (!field) return { ok: false, error: "UNKNOWN_COPY_KEY" };

  const value = normalizeCopy(rawValue);
  if (value.length === 0) return { ok: false, error: "COPY_EMPTY" };
  if (value.length > field.maxLength) return { ok: false, error: "COPY_TOO_LONG" };

  return { ok: true, value };
}

export type BilingualSiteCopyValidation =
  | { ok: true; fr: string; en: string }
  | { ok: false; error: SiteCopyError };

/**
 * Valide une édition **bilingue** (D9, `docs/features/I18N_MIGRATION_PLAN.md`) :
 * le français d'abord, puis l'anglais, **obligatoire** — un texte enregistré
 * sans sa traduction serait servi en français sous `/en`, ou remplacé par un
 * anglais d'origine qui ne dit plus la même chose. Même plafond dans les deux
 * langues : c'est la mise en page qui le fixe, pas la langue.
 */
export function validateBilingualSiteCopy(
  key: string,
  rawFr: unknown,
  rawEn: unknown,
): BilingualSiteCopyValidation {
  const fr = validateSiteCopy(key, rawFr);
  if (!fr.ok) return fr;
  const field = FIELD_BY_KEY.get(key) as SiteCopyField;
  const en = normalizeCopy(rawEn);
  if (en.length === 0) return { ok: false, error: "COPY_EN_EMPTY" };
  if (en.length > field.maxLength) return { ok: false, error: "COPY_EN_TOO_LONG" };
  return { ok: true, fr: fr.value, en };
}

/** Clé de stockage dans `bg_settings` : `copy_<clé>` (français), `copy_<clé>__en` (anglais). */
export function siteCopySettingKey(key: SiteCopyKey, locale: Locale = DEFAULT_LOCALE): string {
  return locale === DEFAULT_LOCALE ? `copy_${key}` : `copy_${key}__${locale}`;
}

/** Un texte tel que l'éditeur le reprend : les deux langues, et l'anglais à rédiger. */
export type SiteCopyEditorEntry = {
  fr: string;
  /** Anglais enregistré ; à défaut, l'anglais d'origine si le français l'est aussi, sinon vide. */
  en: string;
  /** Français édité **sans** anglais enregistré (saisi avant le lot 2) : anglais à rédiger. */
  enMissing: boolean;
};

export type SiteCopyBundle = {
  /** Textes servis sous `/` (défauts compris). */
  fr: SiteCopy;
  /** Textes servis sous `/en` — jamais un repli sur le français. */
  en: SiteCopy;
  /** Ce que l'éditeur reprend, texte par texte. */
  editor: Record<SiteCopyKey, SiteCopyEditorEntry>;
  /** Textes dont le français a été édité sans anglais : la liste de rattrapage. */
  missingEn: SiteCopyKey[];
};

const hasText = (value: string | undefined): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * Textes des deux langues d'après les lignes de `bg_settings` (clé → valeur).
 *
 * Règle de rattrapage (lot 2) — **aucun texte français sous `/en`** :
 *
 * - anglais enregistré → servi ;
 * - pas d'anglais, français d'origine → l'anglais d'origine, sa traduction ;
 * - pas d'anglais, français **édité** (avant que l'éditeur ne demande
 *   l'anglais) → l'anglais d'origine aussi, faute de mieux, et le texte entre
 *   dans `missingEn` : l'éditeur le signale (« EN à rédiger ») jusqu'à ce que
 *   le staff saisisse sa traduction. Rien n'est écrit en base à sa place.
 *
 * Une valeur vide en base vaut une clé absente (la page ne se vide jamais).
 */
export function resolveSiteCopy(stored: ReadonlyMap<string, string>): SiteCopyBundle {
  const fr = defaultSiteCopy("fr");
  const en = defaultSiteCopy("en");
  const editor = {} as Record<SiteCopyKey, SiteCopyEditorEntry>;
  const missingEn: SiteCopyKey[] = [];

  for (const field of SITE_COPY_FIELDS) {
    const storedFr = stored.get(siteCopySettingKey(field.key, "fr"));
    const storedEn = stored.get(siteCopySettingKey(field.key, "en"));
    const frEdited = hasText(storedFr);
    if (frEdited) fr[field.key] = storedFr;
    if (hasText(storedEn)) en[field.key] = storedEn;

    const enMissing = frEdited && !hasText(storedEn);
    if (enMissing) missingEn.push(field.key);
    editor[field.key] = { fr: fr[field.key], en: enMissing ? "" : en[field.key], enMissing };
  }

  return { fr, en, editor, missingEn };
}

/**
 * Français réécrit dans l'éditeur, anglais laissé tel quel : l'anglais
 * enregistré ne suivrait plus. Rien n'est refusé (une coquille corrigée ne
 * change pas le sens), mais l'éditeur le signale avant l'envoi. Un anglais
 * encore vide relève de `enMissing`, pas d'ici.
 */
export function isSiteCopyEnStale(entry: SiteCopyEditorEntry, draftFr: string, draftEn: string): boolean {
  return entry.en !== "" && draftEn === entry.en && draftFr.trim() !== entry.fr.trim();
}

/** Toutes les clés de stockage du registre, dans les deux langues. */
export function siteCopySettingKeys(): string[] {
  return SITE_COPY_FIELDS.flatMap((field) => [
    siteCopySettingKey(field.key, "fr"),
    siteCopySettingKey(field.key, "en"),
  ]);
}

/**
 * Phrases des refus de l'éditeur (staff, en français — l'administration n'est
 * pas traduite, D4).
 */
export const SITE_COPY_ERROR_MESSAGES: Readonly<Record<SiteCopyError, string>> = {
  UNKNOWN_COPY_KEY: "Ce texte n'existe pas (ou plus).",
  COPY_EMPTY: "Le texte français est requis.",
  COPY_TOO_LONG: "Texte français trop long.",
  COPY_EN_EMPTY: "La traduction anglaise est requise.",
  COPY_EN_TOO_LONG: "Traduction anglaise trop longue.",
};

/** Champ de l'éditeur que chaque refus désigne (`useFieldErrors`). */
export const SITE_COPY_FIELD_ERRORS = {
  COPY_EMPTY: "fr",
  COPY_TOO_LONG: "fr",
  COPY_EN_EMPTY: "en",
  COPY_EN_TOO_LONG: "en",
} as const satisfies Readonly<Partial<Record<SiteCopyError, "fr" | "en">>>;

/** Phrase d'un refus de l'éditeur ; un code inconnu (réseau, droits) garde la phrase de repli. */
export function siteCopyErrorMessage(code: string | null | undefined, fallback: string): string {
  if (code && Object.hasOwn(SITE_COPY_ERROR_MESSAGES, code)) {
    return SITE_COPY_ERROR_MESSAGES[code as SiteCopyError];
  }
  return fallback;
}

