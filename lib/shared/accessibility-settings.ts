/**
 * Réglages d'accessibilité du lecteur — le menu du bouton flottant.
 *
 * Chaque réglage **change l'apparence** du site (contraste, police, liens,
 * focus, espacement, mouvement) : il est donc **désactivé par défaut** et ne
 * s'active que par le choix du lecteur. Le site de base garde son esthétique ;
 * qui en a besoin la déplace, pour lui seul.
 *
 * Le mécanisme tient en un attribut : `<html data-a11y="contrast focus …">`,
 * une liste de mots séparés par des espaces que `app/globals.css` lit par
 * `:root[data-a11y~="<clé>"]`. Aucun composant n'a à connaître un réglage — un
 * écran ajouté demain en hérite sans une ligne —, et le balayage
 * `tests/app/accessibility-styles.test.ts` exige qu'à chaque clé du registre
 * corresponde au moins une règle de la feuille : une clé sans règle serait un
 * interrupteur qui ne fait rien.
 *
 * Le choix est gardé dans un **cookie** et non dans `localStorage` : c'est le
 * seul état du navigateur qu'une requête transporte, et le serveur doit poser
 * l'attribut **dans le HTML initial** — appliqué après l'hydratation, un
 * contraste renforcé ferait d'abord clignoter la page dans ses couleurs
 * d'origine, à chaque chargement, précisément chez qui ne les lit pas. Le
 * cookie n'existe que si un réglage est actif, et ne contient que les clés.
 */

/** Clés des réglages, dans l'ordre d'affichage du menu. */
export const A11Y_SETTING_KEYS = ["contrast", "focus", "links", "font", "spacing", "motion"] as const;

export type A11ySettingKey = (typeof A11Y_SETTING_KEYS)[number];

export interface A11ySettingDefinition {
  key: A11ySettingKey;
  /** Intitulé de l'interrupteur. */
  label: string;
  /** Ce que le réglage change, en une phrase. */
  description: string;
}

/** Registre des réglages : source unique du menu et du balayage des styles. */
export const A11Y_SETTINGS: readonly A11ySettingDefinition[] = [
  {
    key: "contrast",
    label: "Contraste renforcé",
    description: "Textes secondaires plus clairs, bordures plus marquées, fonds moins transparents.",
  },
  {
    key: "focus",
    label: "Focus très visible",
    description: "Un anneau épais autour de l'élément atteint au clavier.",
  },
  {
    key: "links",
    label: "Liens soulignés",
    description: "Tous les liens de texte sont soulignés, pas seulement colorés.",
  },
  {
    key: "font",
    label: "Police simplifiée",
    description: "Une seule police sans empattement, sans majuscules forcées ni lettres espacées.",
  },
  {
    key: "spacing",
    label: "Espacement du texte",
    description: "Plus d'air entre les lignes, les mots, les lettres et les paragraphes.",
  },
  {
    key: "motion",
    label: "Réduire les animations",
    description: "Arrête les animations décoratives et les transitions, même si ton système ne le demande pas.",
  },
];

/**
 * Nom du cookie qui porte le choix.
 *
 * Il est déclaré sur `/rgpd` mais **pas** dans `PRIVACY_CHANGES`, et c'est
 * voulu : il ne porte aucune donnée sur une personne (seulement des clés de
 * réglage, sans identifiant), n'est déposé qu'à la demande du lecteur et reste
 * dans le périmètre déjà annoncé à tous (« seuls des cookies techniques sont
 * déposés »). Une modale imposée à chaque compte pour une préférence
 * d'affichage n'informerait de rien.
 */
export const A11Y_COOKIE = "bg_a11y";

/** Durée de vie du cookie : un an, renouvelée à chaque changement. */
export const A11Y_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** Séparateur dans le cookie : un caractère qui n'a pas à être encodé. */
const COOKIE_SEPARATOR = ".";

export function isA11ySettingKey(value: unknown): value is A11ySettingKey {
  return typeof value === "string" && (A11Y_SETTING_KEYS as readonly string[]).includes(value);
}

/**
 * Remet une liste de clés dans l'ordre du registre, sans doublon. L'ordre ne
 * change rien au rendu, mais deux choix identiques doivent produire le même
 * cookie et le même attribut.
 */
export function normalizeA11ySettings(keys: Iterable<A11ySettingKey>): A11ySettingKey[] {
  const wanted = new Set(keys);
  return A11Y_SETTING_KEYS.filter((key) => wanted.has(key));
}

/**
 * Lit la valeur brute du cookie. Tout ce qui n'est pas une clé connue est
 * ignoré : la valeur vient du navigateur, un réglage retiré demain ne doit pas
 * casser la page de ceux qui l'avaient coché.
 */
export function parseA11yCookie(value: string | undefined | null): A11ySettingKey[] {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return [];
  return normalizeA11ySettings(value.split(COOKIE_SEPARATOR).map((part) => part.trim()).filter(isA11ySettingKey));
}

/** Valeur du cookie pour une liste de clés — vide quand rien n'est actif. */
export function serializeA11ySettings(keys: Iterable<A11ySettingKey>): string {
  return normalizeA11ySettings(keys).join(COOKIE_SEPARATOR);
}

/**
 * Valeur de l'attribut `data-a11y` de `<html>`, ou `undefined` quand rien
 * n'est actif — l'attribut est alors absent, et le site est exactement celui
 * d'avant ce menu.
 */
export function a11yAttribute(keys: Iterable<A11ySettingKey>): string | undefined {
  const normalized = normalizeA11ySettings(keys);
  return normalized.length > 0 ? normalized.join(" ") : undefined;
}

/** Active ou désactive une clé et rend la liste normalisée. */
export function toggleA11ySetting(
  keys: Iterable<A11ySettingKey>,
  key: A11ySettingKey,
  enabled: boolean,
): A11ySettingKey[] {
  const next = new Set(keys);
  if (enabled) next.add(key);
  else next.delete(key);
  return normalizeA11ySettings(next);
}

/**
 * Chaîne `document.cookie` qui enregistre le choix — ou l'efface quand plus
 * rien n'est actif, pour qu'un visiteur revenu aux réglages d'origine ne garde
 * pas un cookie qui ne dit rien.
 */
export function a11yCookieString(keys: Iterable<A11ySettingKey>, secure: boolean): string {
  const value = serializeA11ySettings(keys);
  const maxAge = value.length > 0 ? A11Y_COOKIE_MAX_AGE : 0;
  return `${A11Y_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
