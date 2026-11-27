/**
 * Rangs Overwatch lus dans une annonce GETI.
 *
 * Porté de `extractRanks` du bot (Marvel Rivals, paliers seuls) et étendu à
 * Overwatch : paliers Bronze → Champion (Émeraude compris), divisions 5 → 1, formes abrégées
 * (« d3 », « gm1 »), fourchettes (« d3-m2 », « diam 3-1 »), bornes ouvertes
 * (« master+ », « max d1 »), « top 500 », SR de scrim (« 3500 sr », « 4k2 »,
 * « 3k4-5 », « 3.4-3.5k », « SR 3.6-3.7 ») et rang par rôle (« tank m2 / dps d1 »).
 *
 * Un rang vaut un entier de 0 (Bronze 5) à 44 (Champion 1) ; un palier sans
 * division couvre ses cinq divisions.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import { NOT_AFTER_WORD, NOT_BEFORE_WORD, aliasKey, aliasTable } from "@/lib/shared/geti/normalize";
import type { GetiRoleToken } from "@/lib/shared/geti/roles";
import {
  GETI_TIERS,
  type GetiDivision,
  type GetiRank,
  type GetiRankRange,
  type GetiRankedRole,
  type GetiRanks,
  type GetiTier,
} from "@/lib/shared/geti/types";

const DIVISIONS = 5;
/** Valeur du plus haut rang (Champion 1). */
export const GETI_RANK_TOP = GETI_TIERS.length * DIVISIONS - 1;

/**
 * Valeur ordonnée d'un rang : 0 (Bronze 5) à {@link GETI_RANK_TOP} (Champion 1).
 *
 * @param rank Rang à situer.
 * @returns Sa valeur.
 */
export function getiRankValue(rank: GetiRank): number {
  return GETI_TIERS.indexOf(rank.tier) * DIVISIONS + (DIVISIONS - rank.division);
}

/**
 * Rang d'une valeur, ramenée dans l'échelle si elle en sort.
 *
 * @param value Valeur ordonnée.
 * @returns Le rang correspondant.
 */
export function getiRankFromValue(value: number): GetiRank {
  const bounded = Math.min(GETI_RANK_TOP, Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0));
  return {
    tier: GETI_TIERS[Math.floor(bounded / DIVISIONS)],
    division: (DIVISIONS - (bounded % DIVISIONS)) as GetiDivision,
  };
}

/** Alias des paliers, en minuscules et sans accents (fautes courantes comprises). */
const TIER_ALIASES: Readonly<Record<GetiTier, readonly string[]>> = {
  BRONZE: ["bronze", "bronzes"],
  // « argent » est aussi un mot courant (« sans argent ») : lu avec une division seulement.
  SILVER: ["silver", "silvers", "argent"],
  GOLD: ["gold", "golds"],
  PLATINUM: ["platinum", "platine", "platines", "platinium", "platnium", "plat", "plats"],
  EMERALD: ["emeraude", "emeraudes", "emerald", "emeralds", "emer", "eme"],
  DIAMOND: [
    "diamond",
    "diamonds",
    "diamant",
    "diamants",
    "diamand",
    "diamands",
    "dimond",
    "diamon",
    "diams",
    "diam",
    "dia",
  ],
  MASTER: ["master", "masters", "maitre", "maitres", "mastre"],
  GRANDMASTER: ["grand master", "grand masters", "grand maitre", "grand maitres", "gm", "gms"],
  CHAMPION: ["champion", "champions", "champ", "champs"],
};

/** Alias lus seulement suivis d'une division. */
const NEEDS_DIVISION = new Set(["argent"]);

/**
 * Abréviations qui sont aussi des mots courants, écartées sans division dans
 * leur sens courant : « gm tout le monde » (salut), « un plat de pâtes »,
 * « à plat », « champ de bataille ». « lft gm », « diam ou plat » restent des rangs.
 */
type CommonSense = { before?: RegExp; after?: RegExp };

/** Un des mots, juste avant (`wordBefore`) ou juste après (`wordAfter`) l'abréviation. */
function wordBefore(words: string): RegExp {
  return new RegExp(String.raw`${NOT_AFTER_WORD}(?:${words.split(" ").join("|")})\s$`, "u");
}

/** `elided` : « d' » élidé, collé au mot qui suit (« un plat d'entrée »). */
function wordAfter(words: string, elided = false): RegExp {
  const elision = elided ? "|d'" : "";
  return new RegExp(String.raw`^\s(?:(?:${words.split(" ").join("|")})${NOT_BEFORE_WORD}${elision})`, "u");
}

/**
 * Mots qui relient deux rangs (« gold à plat », « du silver au plat ») : devant
 * l'abréviation, ils ne la font courante que si aucun rang ne les précède.
 */
const JOIN_BEFORE = new Set(["a", "au", "du"]);
const WORD_BEFORE = /(\p{L}+)\s$/u;

const GREETED = "tout tous toutes a\\stous all everyone every1 les la\\steam the\\steam guys y'?all friends? frerots? la\\scommu chat";
const TITLE_BEFORE =
  "open inter intermediate intermediaire adv advanced avance expert division div faceit lan tournoi tournament cup";
const TITLE_AFTER = "de du des of";
/** « GM tous rôles », « GM all roles », « GM, Master » : une liste de rangs, pas un salut. */
const GM_LIST_AFTER = new RegExp(
  String.raw`^[^\S\n]*(?:[,/&-][^\S\n]*|(?:tous|toutes|all|les)[^\S\n]+(?:les[^\S\n]+)?)(?:roles?|rangs?|ranks?|tanks?|dps|supp(?:ort)?s?|heal(?:er)?s?|flex|bronze|silver|gold|plat(?:ine|inum)?|eme(?:r|raude|rald)?s?|diam(?:ant|ond)?s?|masters?|maitres?|champ(?:ion)?s?|top\s?500|t500|[bsgpedmc][1-5])${NOT_BEFORE_WORD}`,
  "u",
);
const COMMON_WORD_SENSES: Readonly<Record<string, CommonSense>> = {
  gm: {
    before: /(?:^|\n)[^\S\n]*$/u,
    after: new RegExp(String.raw`^[^\S\n]*(?:[!,]|(?:${GREETED.split(" ").join("|")})${NOT_BEFORE_WORD})`, "u"),
  },
  plat: {
    // « à plat », mais « jusqu'à plat » est une borne de rang.
    before: wordBefore("un le ce mon ton son notre votre leur du (?<!jusqu['\\s]?)a au bon gros petit"),
    after: wordAfter("de du des principal prefere chaud froid", true),
  },
  plats: {
    before: wordBefore("les des mes tes ses nos vos leurs bons petits"),
    after: wordAfter("de du des cuisines?", true),
  },
  champ: {
    before: wordBefore("le un du au ce mon ton son en\\splein"),
    after: wordAfter("de du des libre lexical", true),
  },
  // Un titre, pas un rang : « S10 Intermediate Champion », « champion de France ».
  champion: { before: wordBefore(TITLE_BEFORE), after: wordAfter(TITLE_AFTER, true) },
  champions: { before: wordBefore(TITLE_BEFORE), after: wordAfter(TITLE_AFTER, true) },
};

/**
 * Sens du mot : `rank`, `common` (sens courant, écarté) ou `join` (courant
 * seulement si aucun rang ne précède le mot de liaison : « gold à plat »).
 */
type WordSense = "rank" | "common" | "join";

function wordSense(lower: string, key: string, match: RegExpExecArray): WordSense {
  const sense = COMMON_WORD_SENSES[key];
  if (sense === undefined || match[2] !== undefined) return "rank";
  const end = match.index + match[0].length;
  const before = lower.slice(Math.max(0, match.index - 16), match.index);
  const after = lower.slice(end, end + 30);
  if (/^\s?\+/u.test(after)) return "rank";
  // « gm » salue en tête de ligne seulement, et pas devant une liste de rangs.
  if (key === "gm") {
    const greeting = (sense.before?.test(before) ?? false) && (sense.after?.test(after) ?? false);
    return greeting && !GM_LIST_AFTER.test(after) ? "common" : "rank";
  }
  if (sense.after?.test(after) ?? false) return "common";
  if (!(sense.before?.test(before) ?? false)) return "rank";
  const joining = WORD_BEFORE.exec(before);
  return joining !== null && JOIN_BEFORE.has(joining[1]) ? "join" : "common";
}

/** Initiale d'un palier, lue seulement collée à une division (« d3 », « m1 »). */
const TIER_LETTERS: Readonly<Record<string, GetiTier>> = {
  b: "BRONZE",
  s: "SILVER",
  g: "GOLD",
  p: "PLATINUM",
  e: "EMERALD",
  d: "DIAMOND",
  m: "MASTER",
  c: "CHAMPION",
};

const TIER_TABLE = aliasTable(TIER_ALIASES);
const NAMED_RANK = new RegExp(
  String.raw`${NOT_AFTER_WORD}(${TIER_TABLE.pattern})(?:\s?([1-5])(?:\s?[-–/]\s?([1-5]))?)?${NOT_BEFORE_WORD}`,
  "gu",
);
const LETTER_RANK = new RegExp(
  String.raw`${NOT_AFTER_WORD}([bsgpedmc])([1-5])(?:[-–/]([1-5]))?${NOT_BEFORE_WORD}`,
  "gu",
);
/**
 * « e3 » est d'abord autre chose (un salon, une salle, un événement) : lu comme
 * Émeraude 3 seulement en contexte de rang — derrière un libellé ou un rôle
 * (« rank : e5 », « tank e2 »), ou relié à un autre rang (« e3-d5 », « p1 / e4 »).
 */
const RANK_WORDS = String.raw`[bsgpdmc][1-5]|gm[1-5]?|plat\p{L}*|diam\p{L}*|masters?|gold|silver|bronze|champ\p{L}*`;
const ROLE_WORDS = String.raw`tanks?|dps|supp?(?:orts?)?|heal(?:er)?s?|hs|hitscan|fdps|flex|ms|fs|mt|ot`;
const LINK = String.raw`[^\S\n]*(?:[:=()>~/,&–-][^\S\n]*)*(?:(?:a|au|to|et|and|ou|or)[^\S\n]+)?`;
const EMERALD_LETTER_BEFORE = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:rang|rank|peak|pick|elo|current|currently|actuel|actuellement|niveau|level|lvl|${ROLE_WORDS}|${RANK_WORDS})${LINK}$`,
  "u",
);
const EMERALD_LETTER_AFTER = new RegExp(
  String.raw`^${LINK}(?:peak|${ROLE_WORDS}|${RANK_WORDS})${NOT_BEFORE_WORD}`,
  "u",
);
/**
 * Une initiale + chiffre n'est pas un rang derrière « saison » (« depuis la s2 »)
 * ou « jouer à » (« je joue à D2 », un jeu), ni collée à « ex- » (« ex-G2 ») ;
 * « ex d1 », « ancien m1 », « je joue d2 » restent des rangs.
 */
const NOT_LETTER_RANK_BEFORE = new RegExp(
  String.raw`(?:${NOT_AFTER_WORD}(?:saison|season|depuis la|since|jou(?:e|es|ent|er|ons|ez|ais|ait)\s(?:aussi\s)?a)\s?|${NOT_AFTER_WORD}ex-)$`,
  "u",
);
/** … ni devant « esport » (« G2 Esports »). */
const NOT_LETTER_RANK_AFTER = /^[\s-]?(?:e-?sports?|gaming)(?![\p{L}\p{N}])/u;
/** « depuis s1 » est une saison ; « depuis d2 » reste un rang. */
const SEASON_SINCE_BEFORE = new RegExp(String.raw`${NOT_AFTER_WORD}depuis\s?$`, "u");
const TOP_500 = new RegExp(String.raw`${NOT_AFTER_WORD}(?:top\s?500|t500)${NOT_BEFORE_WORD}`, "gu");
/**
 * SR en milliers : « 4k », « 4.2k », « 3k5 », « 3k+ » — un rang (« 4k »
 * ≈ Grand maître), sauf dans un contexte net qui en fait autre chose. Une
 * fourchette de centaines suit parfois le chiffre : « 3k4-5 », « 2k5/7 ».
 */
const SR_THOUSANDS = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,#])([1-5])(?:[.,](\d))?k(?:(\d)(?:[-/](\d)(?![\p{L}\p{N}.,:]))?)?(?:\s?(sr|elo))?${NOT_BEFORE_WORD}`,
  "gu",
);
/**
 * Fourchette dont seule la seconde borne porte le « k » : « 3.4-3.5k »,
 * « 3.5-6k » (3 500 à 3 600), « 3.2-3k » (3 200 à 3 000), « 3.5/4k ».
 */
const SR_DECIMAL_RANGE = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,#])([1-4])[.,](\d)\s?[-–/]\s?(?:([1-5])[.,](\d)|(\d))\s?k${NOT_BEFORE_WORD}`,
  "gu",
);
/**
 * SR décimal nu, lu dans une recherche de scrim ou de remplaçant seulement :
 * « LFS EU PC 3.6-3.7 », « LFS 4.5 20-22 », « adv 4.5+ ».
 */
const SR_BARE_DECIMAL = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,#/:–-])([1-4])[.,](\d)(?:\s?[-–/]\s?([1-5])[.,](\d))?(?![\p{L}\p{N}]|[.,:/–-]\p{N}|\s?%)`,
  "gu",
);
/** SR décimal derrière son libellé, sans « k » : « SR 3.6-3.7 », « elo : 3.2 ». */
const SR_LABELLED_DECIMAL = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:sr|elo)\s?:?\s?([1-4])[.,](\d)(?:\s?[-–/]\s?([1-5])[.,](\d))?(?![\p{L}\p{N}.,])`,
  "gu",
);
/**
 * Ce qu'un nombre compte quand ce n'est pas un SR : « 1500+ heures »,
 * « 1k abonnés », « 1k€ », « 4k 60 fps », « 4k écran ».
 */
const COUNTED_AFTER = new RegExp(
  String.raw`^\s?\+?\s?(?:h|hrs?|heures?|hours?|€|\$|euros?|dollars?|abonnes?|followers?|subs?|joueurs?|players?|membres?|members?|personnes?|people|gens|inscrits?|messages?|msgs?|points?|pts|kills?|morts?|deaths?|games?|parties|matchs?|viewers?|vues|views|balles|ans|minutes|hz|ecrans?|screens?|monitors?|moniteurs?|tv|uhd|hdr|\d{2,3}\s?(?:fps|hz))(?![\p{L}\p{N}])`,
  "u",
);
/** … ou ce qui le précède : « écran 4k », « cashprize 1k », « $4k », « résolution 4k ». */
const NOT_RANK_BEFORE = new RegExp(
  String.raw`(?:${NOT_AFTER_WORD}(?:ecrans?|screens?|monitors?|moniteurs?|resolution|tv|televiseur|video|videos|stream|qualite|quality|cash\s?prize|prize\s?pool|prize|dotation|budget|prix|price|salaire|salary|recompense|reward|code|id|pin|tag|ref|numero|num|tel|telephone|phone|loi|law)\s?:?\s?(?:de\s|en\s|of\s|in\s)?|[€$£]\s?)$`,
  "u",
);
/**
 * Suite de chiffres groupés (un numéro de téléphone) : un numéro, pas un SR.
 * Il en faut deux autres groupes autour, ou un groupe collé par « . » ou « - »,
 * ou un indicatif devant : « 4200 20 ans » garde son SR. Un horaire voisin n'est
 * pas un groupe de numéro : « 3500 21-23 », « 20-22 3500 ».
 */
const GROUPS_BEFORE = /(?:\d+[\s.-]){2,}$/u;
const GROUPS_AFTER = /^(?:[\s.-]\d+){2,}/u;
const GROUP_BEFORE = /\d[\s.-]$/u;
const GROUP_AFTER = /^[\s.-]\d/u;
const GLUED_GROUP_BEFORE = /\d{2}[.-]$/u;
const GLUED_GROUP_AFTER = /^[.-]\d{2}/u;
const PHONE_PREFIX = /(?:\+\d{1,3}|(?<!\d)0\d?)[\s.-]?$/u;
const TIME_RANGE_AFTER = /^\s\d{1,2}\s?[-–/]\s?\d{1,2}(?!\p{N}|[\s.-]\d)/u;
const TIME_RANGE_BEFORE = /(?<![\p{N}.-]|\d\s)\d{1,2}\s?[-–/]\s?\d{1,2}\s$/u;

function isPhoneNumber(numbersBefore: string, numbersAfter: string): boolean {
  const before = numbersBefore.replace(TIME_RANGE_BEFORE, "");
  const after = numbersAfter.replace(TIME_RANGE_AFTER, "");
  if (GROUPS_BEFORE.test(before) || GROUPS_AFTER.test(after)) return true;
  if (GROUP_BEFORE.test(before) && GROUP_AFTER.test(after)) return true;
  return GLUED_GROUP_BEFORE.test(before) || GLUED_GROUP_AFTER.test(after) || PHONE_PREFIX.test(before);
}
/** SR en chiffres : « 3500 sr », « 4400+ », « 3500-4000 ». */
const SR_NUMBER = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,#])([1-4]\d{3}|5000)(?:\s?[-–/]\s?([1-4]\d{3}|5000))?(?:\s?(sr|elo)|(\+))?${NOT_BEFORE_WORD}`,
  "gu",
);

const OPEN_UP_AFTER = new RegExp(
  String.raw`^\s?(?:\+|(?:min(?:imum|i)?|et plus|ou plus|or higher|or above|and above|and higher|and up)${NOT_BEFORE_WORD})`,
  "u",
);
const OPEN_DOWN_AFTER = new RegExp(
  String.raw`^\s?(?:max(?:imum|i)?|et moins|ou moins|or below|or lower|and below)${NOT_BEFORE_WORD}`,
  "u",
);
const OPEN_UP_BEFORE = new RegExp(
  String.raw`(?:${NOT_AFTER_WORD}(?:min(?:imum|i)?|au moins|at least|a partir de)|>=?|≥)\s?:?\s?$`,
  "u",
);
const OPEN_DOWN_BEFORE = new RegExp(
  String.raw`(?:${NOT_AFTER_WORD}(?:max(?:imum|i)?|jusqu'?\s?au?|up to)|<=?|≤)\s?:?\s?$`,
  "u",
);
const MARKER_WINDOW = 16;

/** Texte admis entre deux rangs d'une même fourchette ou d'une même liste. */
const RANK_JOIN = new RegExp(String.raw`^ ?(?:[-–—~/,&]|=?>|->|→|a|au|to|et|and|ou|or)? ?$`, "u");
/** Texte admis entre deux rôles d'une même liste (« tank/dps », « tank et dps »). */
const ROLE_JOIN = /^ ?(?:[-/,&+]|et|and|ou|or)? ?$/u;
/** Ponctuation admise entre un rôle et son rang. */
const GAP_PUNCTUATION = String.raw`[ :=()[\]>~-]*`;
const GAP_WORDS = "main|peak|rank|rang|elo|niveau|level|lvl|actuel|actuellement|current|currently|est|is|en|at";
/** Texte admis entre un rôle et son rang (« tank : m2 », « dps peak d1 »). */
const ROLE_RANK_GAP = new RegExp(`^${GAP_PUNCTUATION}(?:(?:${GAP_WORDS})${GAP_PUNCTUATION}){0,3}$`, "u");
const ROLE_RANK_GAP_MAX = 30;
/**
 * Texte entre deux rangs d'un même rôle (« tank peak gm, actuellement m1 ») : le
 * second suit le rôle du premier.
 */
const SAME_ROLE_GAP = new RegExp(
  String.raw`^[ ,;:=()[\]>~/-]*(?:(?:${GAP_WORDS}|mais|but|now|maintenant|aujourd'hui|today|avant|before|formerly|anciennement)[ ,;:=()[\]>~/-]*){0,3}$`,
  "u",
);

/** Années plausibles : « 2025-2026 » n'est pas une fourchette de SR. */
const YEAR_MIN = 2015;
const YEAR_MAX = 2035;
/** Une année de naissance, plus ancienne, ne se lit que derrière un mot de date. */
const BIRTH_YEAR_MIN = 1950;
const DATE_WORD_BEFORE = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:nee?s?|en|avant|apres|depuis|annee|annees|since|born|before|after|in|class|promo|of)\s?:?\s?$`,
  "u",
);

type RankToken = {
  start: number;
  end: number;
  min: number;
  max: number;
  openUp: boolean;
  openDown: boolean;
};

type ValueRange = { min: number; max: number };
type RankGroup = ValueRange & { start: number; end: number };

function tierSpan(tier: GetiTier, first: string | undefined, second: string | undefined): ValueRange {
  const base = GETI_TIERS.indexOf(tier) * DIVISIONS;
  if (first === undefined) return { min: base, max: base + DIVISIONS - 1 };
  const a = base + DIVISIONS - Number(first);
  const b = second === undefined ? a : base + DIVISIONS - Number(second);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/**
 * Rang d'un SR : 500 points par palier, 100 par division — 2 500 = Émeraude 5,
 * 3 000 = Diamant 5, 3 500 = Master 5, 4 000 = Grand Maître 5, 4 500 =
 * Champion 5 (l'échelle des annonces de scrim, où « 4.5k+ » se lit couramment),
 * plafonné à Champion 1. Sous 3 000, Émeraude décale d'un palier l'ancienne
 * échelle : 2 000 = Platine 5, 1 000 = Argent 5.
 */
function srValue(sr: number): number {
  const steps = Math.floor((sr - 500) / 100);
  return Math.min(GETI_RANK_TOP, Math.max(0, steps));
}

function srSpan(first: number, second: number): ValueRange {
  const values = [srValue(first), srValue(second)];
  return { min: Math.min(...values), max: Math.max(...values) };
}

function isYear(value: number): boolean {
  return value >= YEAR_MIN && value <= YEAR_MAX;
}

function tokenOf(match: RegExpExecArray, span: ValueRange, openUp = false): RankToken {
  return { start: match.index, end: match.index + match[0].length, ...span, openUp, openDown: false };
}

/** Initiale + division qui n'est ni une saison, ni un jeu, ni une équipe (« ex-G2 », « G2 Esports »). */
function isLetterRank(lower: string, match: RegExpExecArray): boolean {
  const end = match.index + match[0].length;
  const before = lower.slice(Math.max(0, match.index - 12), match.index);
  if (NOT_LETTER_RANK_BEFORE.test(before)) return false;
  if (match[1] === "s" && SEASON_SINCE_BEFORE.test(before)) return false;
  if (match[1] === "e") {
    const context = lower.slice(Math.max(0, match.index - 24), match.index);
    if (!EMERALD_LETTER_BEFORE.test(context) && !EMERALD_LETTER_AFTER.test(lower.slice(end, end + 24))) return false;
  }
  return !NOT_LETTER_RANK_AFTER.test(lower.slice(end, end + 12));
}

/**
 * Paliers nommés, initiales collées à une division et « top 500 » ; `joined` :
 * abréviations à confirmer par un rang écrit devant leur mot de liaison.
 */
function tierTokens(lower: string): { tokens: RankToken[]; joined: RankToken[] } {
  const tokens: RankToken[] = [];
  const joined: RankToken[] = [];
  for (const match of lower.matchAll(NAMED_RANK)) {
    const key = aliasKey(match[1]);
    const tier = TIER_TABLE.lookup.get(key);
    if (tier === undefined || (NEEDS_DIVISION.has(key) && match[2] === undefined)) continue;
    const sense = wordSense(lower, key, match);
    if (sense === "common") continue;
    (sense === "join" ? joined : tokens).push(tokenOf(match, tierSpan(tier, match[2], match[3])));
  }
  for (const match of lower.matchAll(LETTER_RANK)) {
    if (isLetterRank(lower, match)) tokens.push(tokenOf(match, tierSpan(TIER_LETTERS[match[1]], match[2], match[3])));
  }
  for (const match of lower.matchAll(TOP_500)) {
    tokens.push(tokenOf(match, { min: GETI_TIERS.indexOf("GRANDMASTER") * DIVISIONS, max: GETI_RANK_TOP }));
  }
  return { tokens, joined };
}

/** Fourchette d'un SR en chiffres, `null` quand le nombre n'en est pas un (nu, ou deux années). */
function srNumberSpan(lower: string, match: RegExpExecArray): ValueRange | null {
  const first = Number(match[1]);
  const second = match[2] === undefined ? first : Number(match[2]);
  const labelled = match[3] !== undefined || match[4] !== undefined;
  // « 4000 » seul est un SR ; « 2025 » seul ou « 2025-2026 » sont des années.
  if (!labelled && isYear(first) && isYear(second)) return null;
  // « né en 2005 », « nés avant 2008 » : une année de naissance.
  const before = lower.slice(Math.max(0, match.index - 12), match.index);
  const birthYear = (value: number) => value >= BIRTH_YEAR_MIN && value <= YEAR_MAX;
  if (!labelled && birthYear(first) && birthYear(second) && DATE_WORD_BEFORE.test(before)) return null;
  return srSpan(first, second);
}

/**
 * Le nombre vise autre chose qu'un rang : unité derrière, montant ou écran
 * devant, ou — pour un nombre sans « k » (`phone`) — chiffres d'un numéro.
 */
function isNotRank(lower: string, match: RegExpExecArray, phone: boolean): boolean {
  const end = match.index + match[0].length;
  const before = lower.slice(Math.max(0, match.index - 20), match.index);
  const after = lower.slice(end, end + 14);
  if (COUNTED_AFTER.test(after) || NOT_RANK_BEFORE.test(before)) return true;
  return phone && isPhoneNumber(before, after);
}

/** Seconde borne de « 3.5-6k » : des centaines (3 600), sauf un millier plausible (« 3.5-4k », « 3.2-3k »). */
function decimalRangeEnd(thousands: number, digit: number): number {
  return digit >= thousands && digit <= 5 ? digit * 1000 : thousands * 1000 + digit * 100;
}

/** SR décimal « 3.6 » ou « 3.6-3.7 » : nu (scrim seulement) ou derrière son libellé. */
function decimalSrTokens(lower: string, scrim: boolean): RankToken[] {
  const matches = [...(scrim ? lower.matchAll(SR_BARE_DECIMAL) : []), ...lower.matchAll(SR_LABELLED_DECIMAL)];
  return matches.map((match) => {
    const first = Number(match[1]) * 1000 + Number(match[2]) * 100;
    const second = match[3] === undefined ? first : Number(match[3]) * 1000 + Number(match[4]) * 100;
    return tokenOf(match, srSpan(first, second));
  });
}

/** SR en milliers : « 3.4-3.5k », « 3.5-6k », « 4k », « 3k4-5 ». */
function thousandSrTokens(lower: string): RankToken[] {
  const tokens: RankToken[] = [];
  for (const match of lower.matchAll(SR_DECIMAL_RANGE)) {
    if (isNotRank(lower, match, false)) continue;
    const thousands = Number(match[1]);
    const first = thousands * 1000 + Number(match[2]) * 100;
    const second =
      match[5] === undefined
        ? Number(match[3]) * 1000 + Number(match[4]) * 100
        : decimalRangeEnd(thousands, Number(match[5]));
    tokens.push(tokenOf(match, srSpan(first, second)));
  }
  for (const match of lower.matchAll(SR_THOUSANDS)) {
    if (match[2] !== undefined && match[3] !== undefined) continue;
    // « 4k sr » est un SR quoi qu'il y ait autour.
    if (match[5] === undefined && isNotRank(lower, match, false)) continue;
    const thousands = Number(match[1]) * 1000;
    const first = thousands + Number(match[2] ?? match[3] ?? 0) * 100;
    const second = match[4] === undefined ? first : thousands + Number(match[4]) * 100;
    tokens.push(tokenOf(match, srSpan(first, second)));
  }
  return tokens;
}

/** SR, en milliers ou en chiffres ; `scrim` lit aussi le décimal nu (« 3.6 »). */
function srTokens(lower: string, scrim: boolean): RankToken[] {
  const tokens: RankToken[] = [...decimalSrTokens(lower, scrim), ...thousandSrTokens(lower)];
  for (const match of lower.matchAll(SR_NUMBER)) {
    const span = srNumberSpan(lower, match);
    const rank = match[3] !== undefined || !isNotRank(lower, match, true);
    if (span !== null && rank) tokens.push(tokenOf(match, span, match[4] !== undefined));
  }
  return tokens;
}

/** « gold à plat », « du gm au champ » : un rang juste avant le mot de liaison confirme le second. */
const JOINED_GAP = /^ (?:a|au|du) $/u;

function rawTokens(lower: string, scrim: boolean): RankToken[] {
  const { tokens, joined } = tierTokens(lower);
  const kept = [...tokens, ...srTokens(lower, scrim)];
  for (const token of joined) {
    if (kept.some((rank) => rank.end <= token.start && JOINED_GAP.test(lower.slice(rank.end, token.start)))) {
      kept.push(token);
    }
  }
  return kept;
}

/** Marqueurs de borne ouverte autour d'un rang, absorbés dans son étendue. */
function withOpenMarkers(lower: string, token: RankToken): RankToken {
  const next = { ...token };
  const after = lower.slice(token.end, token.end + MARKER_WINDOW);
  const up = OPEN_UP_AFTER.exec(after);
  const down = up === null ? OPEN_DOWN_AFTER.exec(after) : null;
  if (up !== null) {
    next.openUp = true;
    next.end += up[0].length;
  } else if (down !== null) {
    next.openDown = true;
    next.end += down[0].length;
  }
  const before = lower.slice(Math.max(0, token.start - MARKER_WINDOW), token.start);
  const upBefore = OPEN_UP_BEFORE.exec(before);
  const downBefore = upBefore === null ? OPEN_DOWN_BEFORE.exec(before) : null;
  if (upBefore !== null) {
    next.openUp = true;
    next.start -= upBefore[0].length;
  } else if (downBefore !== null) {
    next.openDown = true;
    next.start -= downBefore[0].length;
  }
  return next;
}

function rankTokens(lower: string, scrim: boolean): RankToken[] {
  const sorted = rawTokens(lower, scrim).sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: RankToken[] = [];
  for (const token of sorted) {
    const previous = kept.at(-1);
    if (previous !== undefined && token.start < previous.end) continue;
    kept.push(token);
  }
  return kept.map((token) => withOpenMarkers(lower, token));
}

/** Rangs voisins réunis : « d3-m2 », « diam, master », « plat ou diam ». */
function rankGroups(lower: string, tokens: readonly RankToken[]): RankGroup[] {
  const runs: RankToken[][] = [];
  for (const token of tokens) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (run !== undefined && previous !== undefined && RANK_JOIN.test(lower.slice(previous.end, token.start))) {
      run.push(token);
    } else {
      runs.push([token]);
    }
  }
  return runs.map((run) => {
    const [first] = run;
    const range = {
      min: Math.min(...run.map((token) => token.min)),
      max: Math.max(...run.map((token) => token.max)),
    };
    // Une borne ouverte vaut au bout de la liste où elle est écrite (« diam ou
    // master+ » monte jusqu'en haut), sauf si l'autre bout est lui-même une
    // borne : dans « min d3 max m1 », chaque marqueur est borné par l'autre rang.
    const last = run[run.length - 1];
    const single = run.length === 1;
    if (last.openUp && (single || !run.some((token) => token.openDown))) range.max = GETI_RANK_TOP;
    if (first.openDown && (single || !run.some((token) => token.openUp))) range.min = 0;
    return { ...range, start: first.start, end: last.end };
  });
}

type RoleRun = { start: number; end: number; roles: GetiRankedRole[] };

function roleRuns(lower: string, tokens: readonly GetiRoleToken[]): RoleRun[] {
  const runs: RoleRun[] = [];
  for (const token of tokens) {
    const run = runs.at(-1);
    const ranked = token.role === "FLEX" ? [] : [token.role];
    if (run !== undefined && ROLE_JOIN.test(lower.slice(run.end, token.start))) {
      run.end = token.end;
      run.roles.push(...ranked);
    } else {
      runs.push({ start: token.start, end: token.end, roles: ranked });
    }
  }
  return runs;
}

function isRoleRankGap(gap: string): boolean {
  return gap.length <= ROLE_RANK_GAP_MAX && ROLE_RANK_GAP.test(gap);
}

function isSameRoleGap(gap: string): boolean {
  return gap.length <= ROLE_RANK_GAP_MAX && SAME_ROLE_GAP.test(gap);
}


/**
 * Rattache chaque groupe de rangs au rôle écrit juste avant (« tank m2 ») ou,
 * à défaut, juste après (« m2 tank »), sur la même ligne. Une liste de rôles
 * ne sert qu'une fois : dans « m2 tank d1 dps », « tank » va à « m2 » et
 * « d1 » prend donc « dps ».
 */
type OwnedGroup = { group: RankGroup; owner: RoleRun };

/** Rôle écrit contre un groupe, devant puis derrière, parmi ceux qui n'ont pas encore servi. */
function adjacentRun(
  lower: string,
  group: RankGroup,
  runs: readonly RoleRun[],
  used: ReadonlySet<RoleRun>,
): RoleRun | undefined {
  const before = runs.findLast((run) => run.end <= group.start);
  const after = runs.find((run) => run.start >= group.end);
  const candidates = [
    before !== undefined && isRoleRankGap(lower.slice(before.end, group.start)) ? before : undefined,
    after !== undefined && isRoleRankGap(lower.slice(group.end, after.start)) ? after : undefined,
  ];
  return candidates.find((run) => run !== undefined && !used.has(run));
}

function mergeRange(known: ValueRange | undefined, group: ValueRange): ValueRange {
  return known === undefined
    ? { min: group.min, max: group.max }
    : { min: Math.min(known.min, group.min), max: Math.max(known.max, group.max) };
}

function ranksByRole(
  lower: string,
  groups: readonly RankGroup[],
  runs: readonly RoleRun[],
): Partial<Record<GetiRankedRole, ValueRange>> {
  const byRole: Partial<Record<GetiRankedRole, ValueRange>> = {};
  const used = new Set<RoleRun>();
  let previous: OwnedGroup | null = null;
  for (const group of groups) {
    const continued: RoleRun | undefined =
      previous !== null && isSameRoleGap(lower.slice(previous.group.end, group.start)) ? previous.owner : undefined;
    const owner: RoleRun | undefined = adjacentRun(lower, group, runs, used) ?? continued;
    previous = owner === undefined ? null : { group, owner };
    if (owner === undefined) continue;
    used.add(owner);
    for (const role of owner.roles) byRole[role] = mergeRange(byRole[role], group);
  }
  return byRole;
}

function toRankRange(range: ValueRange): GetiRankRange {
  return { min: getiRankFromValue(range.min), max: getiRankFromValue(range.max) };
}

/**
 * Lit les rangs d'un texte préparé : fourchette globale (du plus bas au plus
 * haut rang cité) et fourchette par rôle quand le rôle est écrit contre le rang.
 *
 * @param lower Texte sans accents, en minuscules (`prepareGetiText`).
 * @param roleTokens Rôles déjà repérés dans ce même texte.
 * @param scrim `true` pour une recherche de scrim ou de remplaçant : un
 *   décimal nu (« 3.6 », « 4.5+ ») y est un SR.
 * @returns Les rangs ; `min` et `max` valent `null` quand aucun rang n'est lu.
 */
export function parseGetiRanks(lower: string, roleTokens: readonly GetiRoleToken[], scrim = false): GetiRanks {
  const runs = roleRuns(lower, roleTokens);
  const groups = rankGroups(lower, rankTokens(lower, scrim));
  if (groups.length === 0) return { min: null, max: null, byRole: {} };
  const byRoleValues = ranksByRole(lower, groups, runs);
  const byRole: GetiRanks["byRole"] = {};
  for (const role of ["TANK", "DPS", "SUPPORT"] as const) {
    const range = byRoleValues[role];
    if (range !== undefined) byRole[role] = toRankRange(range);
  }
  return {
    min: getiRankFromValue(Math.min(...groups.map((group) => group.min))),
    max: getiRankFromValue(Math.max(...groups.map((group) => group.max))),
    byRole,
  };
}
