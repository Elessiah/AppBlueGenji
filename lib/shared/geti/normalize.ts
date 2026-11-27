/**
 * Préparation du texte d'une annonce GETI avant analyse.
 *
 * Trois formes : `clean` (casse et accents gardés, pour lire un nom d'équipe),
 * `plain` (sans accents, casse gardée, pour les sigles en capitales) et `lower`
 * (sans accents, en minuscules, où se lisent rangs, rôles et horaires). Le
 * bruit Discord — liens, mentions, balisage, pictogrammes — y devient une
 * espace : il ne doit ni se lire comme un mot ni coller deux mots.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import { withoutInvisiblesKeepingSpaces } from "@/lib/shared/visible-text";

/** Longueur maximale gardée d'une annonce (description d'un encart Discord). */
export const GETI_TEXT_MAX = 4096;

/** Borne gauche d'un mot : ni lettre ni chiffre avant. */
export const NOT_AFTER_WORD = String.raw`(?<![\p{L}\p{N}])`;
/** Borne droite d'un mot : ni lettre ni chiffre après. */
export const NOT_BEFORE_WORD = String.raw`(?![\p{L}\p{N}])`;

const URL_LIKE = /(?:https?:\/\/|discord\.gg\/|www\.)\S+/giu;
/** Émoji de serveur `<:nom:id>` : son nom porte souvent le rang ou le rôle. */
const CUSTOM_EMOJI = /<a?:(\w{1,32}):\d{1,22}>/gu;
const MENTION = /<(?:@[!&]?|#)\d{1,22}>/gu;
const TIMESTAMP = /<t:\d{1,16}(?::[a-zA-Z])?>/gu;
const MARKDOWN = /[*_~`|]+|^[ \t]*(?:>{1,3}|#{1,3}|-#)[ \t]+/gmu;
const REGIONAL_INDICATORS = /[\u{1F1E6}-\u{1F1FF}]/gu;
const PICTOGRAPHS = /\p{Extended_Pictographic}|\uFE0F|\u200D|\u20E3|\p{Emoji_Modifier}/gu;
const DIACRITICS = /\p{M}/gu;
const FLAG = /([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/gu;
const FIRST_INDICATOR = 0x1f1e6;

/**
 * Texte multi-ligne affichable : chaque ligne perd ses contrôles et ses
 * invisibles (`UNTRUSTED_NAMES.md`), les lignes vides en rafale sont réduites à
 * une, le tout borné à {@link GETI_TEXT_MAX} caractères.
 *
 * @param raw Texte brut, de type inconnu.
 * @returns Le texte nettoyé, éventuellement vide.
 */
export function getiDisplayText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const lines = raw
    .slice(0, GETI_TEXT_MAX * 2)
    .split(/\r\n|\r|\n/u)
    .map((line) => withoutInvisiblesKeepingSpaces(line).replace(/\s{2,}/gu, " "));
  return lines
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, GETI_TEXT_MAX)
    .trimEnd();
}

const USER_MENTION = /<@[!&]?\d{1,22}>/gu;
const CHANNEL_MENTION = /<#\d{1,22}>/gu;
const MASS_MENTION = /@(everyone|here)(?![\p{L}\p{N}])/giu;
/** Caractères de balisage et de mention Discord : un nom n'en garde aucun. */
const MARKUP_CHARACTERS = /[\\*_~`|<>@]+/gu;

/**
 * Texte d'annonce à afficher : les mentions d'un compte ou d'un rôle
 * (« <@id> ») deviennent « @… » — l'identifiant Discord d'un tiers ne sort pas
 * —, celles d'un salon « #… », et « @everyone » / « @here » perdent leur « @ ».
 * Le reste du balisage est gardé : il s'affiche en texte, et passe par
 * `discordQuote` avant tout message Discord (`UNTRUSTED_NAMES.md`).
 *
 * @param text Texte déjà passé par {@link getiDisplayText}.
 * @returns Le texte sans mention active.
 */
export function getiSafeText(text: string): string {
  return text.replace(USER_MENTION, "@…").replace(CHANNEL_MENTION, "#…").replace(MASS_MENTION, "$1");
}

/**
 * Nom en texte seul : mentions retirées (l'identifiant Discord d'un tiers ne
 * sort pas), émoji personnalisé réduit à son nom, balisage Markdown, chevrons,
 * « @ » et barres obliques inverses retirés, espaces réduites
 * (« @everyone **Nitro** » → « everyone Nitro »).
 *
 * @param name Nom déjà nettoyé de ses invisibles.
 * @returns Le nom sans caractère de balisage.
 */
export function withoutMarkup(name: string): string {
  return name
    .replace(CUSTOM_EMOJI, " $1 ")
    .replace(MENTION, " ")
    .replace(MARKUP_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Codes des drapeaux d'un texte, dans l'ordre (« FR », « GB »).
 *
 * @param text Texte brut ou affichable.
 * @returns Les codes à deux lettres.
 */
export function getiFlagCodes(text: string): string[] {
  const letter = (indicator: string) =>
    String.fromCodePoint((indicator.codePointAt(0) ?? FIRST_INDICATOR) - FIRST_INDICATOR + 65);
  return [...text.matchAll(FLAG)].map(([, first, second]) => letter(first) + letter(second));
}

export type GetiPreparedText = {
  /** Casse et accents gardés, bruit Discord retiré. */
  clean: string;
  /** Sans accents, casse gardée (sigles en capitales). */
  plain: string;
  /** Sans accents, en minuscules. */
  lower: string;
};

/**
 * Prépare un texte déjà passé par {@link getiDisplayText} pour l'analyse.
 *
 * @param text Texte affichable de l'annonce.
 * @returns Ses formes d'analyse.
 */
export function prepareGetiText(text: string): GetiPreparedText {
  // La forme de compatibilité peut multiplier la longueur (« ﷺ » donne 18 lettres) : on borne à nouveau.
  const clean = text
    .normalize("NFKC")
    .slice(0, GETI_TEXT_MAX * 2)
    .replace(URL_LIKE, " ")
    .replace(CUSTOM_EMOJI, " $1 ")
    .replace(TIMESTAMP, " ")
    .replace(MENTION, " ")
    .replace(REGIONAL_INDICATORS, " ")
    .replace(PICTOGRAPHS, " ")
    .replace(MARKDOWN, " ")
    .replace(/[\u2018\u2019\u00B4]/gu, "'")
    .replace(/[^\S\n]+/gu, " ");
  const plain = clean.normalize("NFD").replace(DIACRITICS, "");
  return { clean, plain, lower: plain.toLowerCase() };
}

/** Échappe un texte pour l'insérer tel quel dans une expression régulière. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/**
 * Alternative d'expression régulière pour une liste d'alias : les plus longs
 * d'abord (« grand master » avant « master »), une espace d'alias tolérant
 * espace, tiret ou rien (« grand-master », « grandmaster »).
 *
 * @param aliases Alias en minuscules, sans accents.
 * @returns Le motif, sans groupe capturant.
 */
export function aliasPattern(aliases: readonly string[]): string {
  return [...aliases]
    .sort((a, b) => b.length - a.length)
    .map((alias) => alias.split(" ").map(escapeRegExp).join(String.raw`[\s-]?`))
    .join("|");
}

/** Forme de comparaison d'un alias reconnu : sans espace ni tiret. */
export function aliasKey(matched: string): string {
  return matched.replace(/[\s-]/gu, "");
}

/**
 * Table alias → valeur à partir d'une liste par valeur ; les clés sont sous
 * leur forme de comparaison ({@link aliasKey}).
 *
 * @param groups Alias de chaque valeur.
 * @returns La table et le motif qui reconnaît n'importe quel alias.
 */
export function aliasTable<T extends string>(
  groups: Readonly<Record<T, readonly string[]>>,
): { lookup: ReadonlyMap<string, T>; pattern: string } {
  const lookup = new Map<string, T>();
  const all: string[] = [];
  for (const value of Object.keys(groups) as T[]) {
    for (const alias of groups[value]) {
      lookup.set(aliasKey(alias), value);
      all.push(alias);
    }
  }
  return { lookup, pattern: aliasPattern(all) };
}

/** Valeurs uniques, dans l'ordre d'une liste de référence. */
export function inReferenceOrder<T>(reference: readonly T[], found: Iterable<T>): T[] {
  const set = new Set(found);
  return reference.filter((value) => set.has(value));
}
