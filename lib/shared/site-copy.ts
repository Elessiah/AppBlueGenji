/**
 * Textes éditables du site vitrine (accueil + page association).
 *
 * Titres, slogans et descriptions sont d'ordinaire figés dans le JSX. Ce
 * registre les sort du code : chaque entrée déclare une clé de stockage, un
 * libellé d'administration et la valeur par défaut — celle qui était écrite en
 * dur, et qui reste servie tant que personne n'a édité le texte.
 *
 * Ajouter un texte éditable = ajouter une entrée ici, puis envelopper le rendu
 * dans `<EditableCopy copyKey="…">`. Module pur : importable partout.
 */

export type SiteCopyKey =
  | "home.hero.eyebrow"
  | "home.hero.title"
  | "home.hero.lede"
  | "home.about.title"
  | "home.about.lede"
  | "home.join.eyebrow"
  | "home.join.title"
  | "home.join.lede"
  | "home.join.lede.member"
  | "association.hero.eyebrow"
  | "association.hero.title"
  | "association.manifesto.lede"
  | "association.membership.lede";

/** Tous les textes de la vitrine, indexés par clé. */
export type SiteCopy = Record<SiteCopyKey, string>;

export type SiteCopyField = {
  key: SiteCopyKey;
  /** Page concernée, pour regrouper dans l'administration. */
  page: "Accueil" | "Association";
  /** Libellé affiché à l'éditeur. */
  label: string;
  defaultValue: string;
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
    multiline: false,
    maxLength: 80,
  },
  {
    key: "home.hero.title",
    page: "Accueil",
    label: "Hero — titre",
    defaultValue: "Organiser,\njouer,\ngagner ensemble.",
    multiline: true,
    maxLength: 160,
  },
  {
    key: "home.hero.lede",
    page: "Accueil",
    label: "Hero — accroche",
    defaultValue:
      "BlueGenji fédère une scène amateur francophone avec des tournois lisibles, des brackets en direct, des arbitres bénévoles et une communauté Discord active autour d'Overwatch 2 et Marvel Rivals.",
    multiline: true,
    maxLength: 600,
  },
  {
    key: "home.about.title",
    page: "Accueil",
    label: "Association — titre de section",
    defaultValue: "L'association",
    multiline: false,
    maxLength: 80,
  },
  {
    key: "home.about.lede",
    page: "Accueil",
    label: "Association — description",
    defaultValue:
      "Une structure associative à but non lucratif, gérée par des bénévoles passionnés. On organise des tournois accessibles, bien arbitrés, avec des cash prizes réinvestis dans la scène amateur française.",
    multiline: true,
    maxLength: 600,
  },
  {
    key: "home.join.eyebrow",
    page: "Accueil",
    label: "Appel final — surtitre",
    defaultValue: "REJOINDRE LA SCÈNE",
    multiline: false,
    maxLength: 80,
  },
  {
    key: "home.join.title",
    page: "Accueil",
    label: "Appel final — slogan",
    defaultValue: "Ton équipe. Notre bracket.\nLe prochain tournoi commence maintenant.",
    multiline: true,
    maxLength: 200,
  },
  {
    key: "home.join.lede",
    page: "Accueil",
    label: "Appel final — description",
    defaultValue:
      "Crée ton compte, monte une équipe de cinq, inscris-la. On s'occupe du reste avec des brackets, du streaming et de l'arbitrage.",
    multiline: true,
    maxLength: 400,
  },
  {
    key: "home.join.lede.member",
    page: "Accueil",
    label: "Appel final — description (membre connecté)",
    defaultValue:
      "Monte une équipe de cinq et inscris-la au prochain tournoi. On s'occupe du reste avec des brackets, du streaming et de l'arbitrage.",
    multiline: true,
    maxLength: 400,
  },
  {
    key: "association.hero.eyebrow",
    page: "Association",
    label: "Hero — surtitre",
    defaultValue: "L'ASSOCIATION · LOI 1901",
    multiline: false,
    maxLength: 80,
  },
  {
    key: "association.hero.title",
    page: "Association",
    label: "Hero — titre",
    defaultValue: "Au service de la scène\namateur française.",
    multiline: true,
    maxLength: 160,
  },
  {
    key: "association.manifesto.lede",
    page: "Association",
    label: "Manifeste — accroche",
    defaultValue:
      "BlueGenji est née de la conviction que l'esport amateur mérite une scène fiable, ouverte et sérieuse — où chacun trouve sa place, quel que soit son niveau.",
    multiline: true,
    maxLength: 600,
  },
  {
    key: "association.membership.lede",
    page: "Association",
    label: "Adhérer — accroche",
    defaultValue:
      "L'adhésion vous ouvre l'accès complet à tous nos tournois, événements et ressources communautaires.",
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
export function defaultSiteCopy(): Record<SiteCopyKey, string> {
  return Object.fromEntries(
    SITE_COPY_FIELDS.map((field) => [field.key, field.defaultValue]),
  ) as Record<SiteCopyKey, string>;
}

export type SiteCopyValidation =
  | { ok: true; value: string }
  | { ok: false; error: "UNKNOWN_COPY_KEY" | "COPY_EMPTY" | "COPY_TOO_LONG" };

/**
 * Valide une édition. Un texte vide est refusé : vider un titre casserait la
 * page sans que l'éditeur puisse revenir en arrière autrement qu'en le
 * retapant. Les fins de ligne sont normalisées (`\r\n` → `\n`).
 */
export function validateSiteCopy(key: string, rawValue: unknown): SiteCopyValidation {
  const field = FIELD_BY_KEY.get(key);
  if (!field) return { ok: false, error: "UNKNOWN_COPY_KEY" };

  const value = String(rawValue ?? "").replace(/\r\n/g, "\n").trim();
  if (value.length === 0) return { ok: false, error: "COPY_EMPTY" };
  if (value.length > field.maxLength) return { ok: false, error: "COPY_TOO_LONG" };

  return { ok: true, value };
}

/** Clé de stockage dans `bg_settings`. */
export function siteCopySettingKey(key: SiteCopyKey): string {
  return `copy_${key}`;
}
