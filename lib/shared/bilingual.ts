/**
 * Textes juridiques bilingues écrits **une seule fois** : la structure
 * (sections, références, ordre, constantes) est commune, et chaque texte qui
 * change d'une langue à l'autre s'écrit à sa place en
 * `frEn("français", "anglais")` — le français fait foi, l'anglais le traduit.
 *
 * Pourquoi : deux fichiers (ou deux moitiés de fichier) qui répètent la même
 * structure ligne à ligne passent pour du code dupliqué aux yeux de
 * SonarCloud, qui ne lit pas le contenu des chaînes ; la moindre retouche d'un
 * texte y faisait alors échouer la barrière de duplication
 * (`docs/features/LEGAL_DATA_FILES.md`).
 *
 * Module pur, sans importation : `localize` rend, pour une langue, l'objet
 * qu'écrivait autrefois le fichier de cette langue, au caractère près.
 */

export type LegalLocale = "fr" | "en";

/** Une valeur (le plus souvent un texte) qui diffère d'une langue à l'autre. */
export interface Bilingual<T> {
  fr: T;
  en: T;
}

type Primitive = string | number | boolean | null | undefined;

/**
 * La forme bilingue d'une valeur `T` : chaque nœud est soit commun aux deux
 * langues (écrit tel quel), soit une paire `{ fr, en }` de valeurs complètes.
 */
export type Localizable<T> =
  | Bilingual<T>
  | (T extends Primitive
      ? T
      : T extends readonly (infer U)[]
        ? readonly Localizable<U>[]
        : { [K in keyof T]: Localizable<T[K]> });

/**
 * Un texte en français, puis sa traduction anglaise : la forme à écrire dans
 * les fichiers juridiques — le français sur la ligne de l'appel, l'anglais
 * sur la suivante. Deux lignes par texte, sans libellé répété : c'est ce qui
 * laisse chaque liste assez peu dense pour que SonarCloud n'y voie pas de
 * duplication.
 */
export function frEn<T>(fr: T, en: T): Bilingual<T> {
  return { fr, en };
}

/** Une paire `{ fr, en }` : un objet simple dont les clés sont exactement `fr` et `en`. */
export function isBilingual(value: unknown): value is Bilingual<unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes("fr") && keys.includes("en");
}

/**
 * La valeur dans une langue : chaque paire `{ fr, en }` cède la place à sa
 * moitié, prise telle quelle ; tableaux et objets sont recopiés, dans le même
 * ordre de clés ; le reste est commun.
 */
export function localize<T>(value: Localizable<T>, locale: LegalLocale): T {
  return localizeValue(value, locale) as T;
}

function localizeValue(value: unknown, locale: LegalLocale): unknown {
  if (isBilingual(value)) return value[locale];
  if (Array.isArray(value)) return value.map((item) => localizeValue(item, locale));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localizeValue(item, locale)]));
  }
  return value;
}

/** Les deux langues d'un texte bilingue, résolues une fois. */
export function inBothLanguages<T>(value: Localizable<T>): Bilingual<T> {
  return { fr: localize(value, "fr"), en: localize(value, "en") };
}
