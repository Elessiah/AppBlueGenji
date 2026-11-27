/**
 * Préparation du texte d'une annonce GETI avant analyse.
 *
 * Trois formes : `clean` (casse et accents gardés, pour lire un nom d'équipe),
 * `plain` (sans accents, casse gardée, pour les sigles en capitales) et `lower`
 * (sans accents, en minuscules, où se lisent rangs, rôles et horaires). Le
 * bruit Discord — liens, mentions, balisage, pictogrammes — y devient une
 * espace : il ne doit ni se lire comme un mot ni coller deux mots. Le nom d'un
 * émoji de serveur (`:Grandmaster:`, `:tank:`) se lit dans `plain` et `lower`,
 * pas dans `clean` : « :LogoStructure: ELDRAVEN » ne nomme pas une équipe.
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
export const CUSTOM_EMOJI = /<a?:(\w{1,32}):\d{1,22}>/gu;
export const MENTION = /<(?:@[!&]?|#)\d{1,22}>/gu;
const TIMESTAMP = /<t:\d{1,16}(?::[a-zA-Z])?>/gu;
/**
 * Balisage : gras, italique, barré, code, masqué (`||…||`), citation, titre.
 * Une barre verticale seule est un séparateur de l'auteur (« Tank | Flex
 * DPS ») : elle reste, pour que « tank » et « flex » ne se lisent pas ensemble.
 */
const MARKDOWN = /[*_~`]+|\|{2,}/gu;
const LINE_PREFIX = /^[ \t]*(?:>{1,3}|#{1,3}|-#)[ \t]+/gmu;
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

/**
 * Code en ligne ou en bloc (`` `…` ``, ```` ```…``` ````), par paires, contenu borné :
 * Discord l'affiche tel quel, une marque `||` ou `**` y est du texte.
 */
export const GETI_CODE_SPAN = /(`{1,3})([^`]{1,4096}?)\1/gu;

/** Plages `[début, fin[` du code d'un texte ({@link GETI_CODE_SPAN}), dans l'ordre. */
export function getiCodeRanges(text: string): Array<[number, number]> {
  if (!text.includes("`")) return [];
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(GETI_CODE_SPAN)) {
    const index = match.index ?? 0;
    ranges.push([index, index + match[0].length]);
  }
  return ranges;
}

/**
 * Prochaine marque `||` hors code à partir de `from` (−1 sinon). `ranges` est
 * parcouru une fois, dans l'ordre : `cursor` garde la première plage utile.
 */
function nextSpoilerMark(text: string, from: number, ranges: Array<[number, number]>, cursor: { at: number }): number {
  let search = from;
  for (;;) {
    const mark = text.indexOf("||", search);
    if (mark === -1) return -1;
    while (cursor.at < ranges.length && ranges[cursor.at][1] <= mark) cursor.at += 1;
    const range = ranges[cursor.at];
    // Une marque (ou sa seconde barre) dans du code : du texte, on reprend après le code.
    if (range !== undefined && mark + 1 >= range[0] && mark < range[1]) {
      search = range[1];
      continue;
    }
    return mark;
  }
}

/**
 * Retire les passages masqués (`||…||`) : l'auteur les a cachés derrière un clic
 * sur Discord, ni la page ni l'analyse ne les lisent (une étiquette tirée d'un
 * passage masqué le montrerait). Même règle que Discord (`\|\|([\s\S]+?)\|\|`) :
 * au moins un caractère masqué, qui peut être une barre (`||||x||` masque `||x`) ;
 * une marque dans du code (`` `||` ``) est du texte. Parcours linéaire, sans
 * borne de longueur ; une marque `||` sans fermante reste du texte.
 *
 * @param text Texte d'annonce.
 * @param replacement Ce qui remplace chaque passage (une espace pour l'analyse, un mot neutre pour la page).
 * @returns Le texte sans contenu masqué.
 */
export function getiWithoutSpoilers(text: string, replacement: string): string {
  if (!text.includes("||")) return text;
  const ranges = getiCodeRanges(text);
  const cursor = { at: 0 };
  let out = "";
  let from = 0;
  for (;;) {
    const open = nextSpoilerMark(text, from, ranges, cursor);
    if (open === -1) break;
    const close = nextSpoilerMark(text, open + 3, ranges, cursor);
    if (close === -1) break;
    out += text.slice(from, open) + replacement;
    from = close + 2;
  }
  return out + text.slice(from);
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
  const bounded = text.normalize("NFKC").slice(0, GETI_TEXT_MAX * 2);
  const prepare = (emoji: string) =>
    bounded
      .replace(URL_LIKE, " ")
      .replace(CUSTOM_EMOJI, emoji)
      .replace(TIMESTAMP, " ")
      .replace(MENTION, " ")
      .replace(REGIONAL_INDICATORS, " ")
      .replace(PICTOGRAPHS, " ")
      .replace(LINE_PREFIX, " ")
      .replace(MARKDOWN, " ")
      .replace(/[\u2018\u2019\u00B4]/gu, "'")
      .replace(/[^\S\n]+/gu, " ");
  // Sans émoji de serveur (le cas courant) les deux formes sont les mêmes : un seul passage.
  const hasEmoji = bounded.includes("<:") || bounded.includes("<a:");
  const clean = prepare(" ");
  const plain = (hasEmoji ? prepare(" $1 ") : clean).normalize("NFD").replace(DIACRITICS, "");
  return { clean, plain, lower: plain.toLowerCase() };
}

/** Échappe un texte pour l'insérer tel quel dans une expression régulière. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/**
 * Alternative d'expression régulière pour une liste d'alias : les plus longs
 * d'abord (« grand master » avant « master »), une espace d'alias tolérant
 * espace, tiret ou rien (« grand-master », « grandmaster ») — jamais un saut de
 * ligne : « DPS » puis « Flex support » à la ligne sont deux postes.
 *
 * @param aliases Alias en minuscules, sans accents.
 * @returns Le motif, sans groupe capturant.
 */
export function aliasPattern(aliases: readonly string[]): string {
  return [...aliases]
    .sort((a, b) => b.length - a.length)
    .map((alias) => alias.split(" ").map(escapeRegExp).join(String.raw`(?:[^\S\n]|-)?`))
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
