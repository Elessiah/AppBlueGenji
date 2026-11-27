/**
 * Rangs Overwatch lus dans une annonce GETI.
 *
 * Porté de `extractRanks` du bot (Marvel Rivals, paliers seuls) et étendu à
 * Overwatch : paliers Bronze → Champion, divisions 5 → 1, formes abrégées
 * (« d3 », « gm1 »), fourchettes (« d3-m2 », « diam 3-1 »), bornes ouvertes
 * (« master+ », « max d1 »), « top 500 », ancien SR (« 3500 sr », « 4k2 »), et
 * rang par rôle (« tank m2 / dps d1 »).
 *
 * Un rang vaut un entier de 0 (Bronze 5) à 39 (Champion 1) ; un palier sans
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

/** Initiale d'un palier, lue seulement collée à une division (« d3 », « m1 »). */
const TIER_LETTERS: Readonly<Record<string, GetiTier>> = {
  b: "BRONZE",
  s: "SILVER",
  g: "GOLD",
  p: "PLATINUM",
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
  String.raw`${NOT_AFTER_WORD}([bsgpdmc])([1-5])(?:[-–/]([1-5]))?${NOT_BEFORE_WORD}`,
  "gu",
);
/** Une initiale + chiffre n'est pas un rang derrière « saison » (« depuis la s2 ») ou « ex- » (« ex-G2 »). */
const NOT_LETTER_RANK_BEFORE = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:saison|season|depuis(?: la)?|since|ex|anciens?|ancienne|former)[\s-]?$`,
  "u",
);
/** … ni devant « esport » (« G2 Esports »). */
const NOT_LETTER_RANK_AFTER = /^[\s-]?(?:e-?sports?|gaming)(?![\p{L}\p{N}])/u;
const TOP_500 = new RegExp(String.raw`${NOT_AFTER_WORD}(?:top\s?500|t500)${NOT_BEFORE_WORD}`, "gu");
/**
 * Ancien SR en milliers : « 4k », « 4.2k », « 3k5 ». « 4k » seul, sans « sr » ni
 * « elo » autour ni rôle contre lui, est un montant (« cashprize 1k », « écran 4k »).
 */
const SR_THOUSANDS = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,#])([1-4])(?:[.,](\d))?k(\d)?(?:\s?(sr|elo))?${NOT_BEFORE_WORD}`,
  "gu",
);
const SR_LABEL_BEFORE = new RegExp(String.raw`${NOT_AFTER_WORD}(?:sr|elo)\s?:?\s?$`, "u");
/** Ce qu'un nombre compte quand ce n'est pas un SR : « 1500+ heures », « 2000 abonnés ». */
const COUNTED_AFTER = new RegExp(
  String.raw`^\s?(?:h|hrs?|heures?|hours?|€|\$|euros?|abonnes?|followers?|joueurs?|players?|membres?|members?|games?|parties|matchs?|viewers?|vues|views)(?![\p{L}\p{N}])`,
  "u",
);
/** Ancien SR en chiffres : « 3500 sr », « 4400+ », « 3500-4000 ». */
const SR_NUMBER = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,#])([1-4]\d{3})(?:\s?[-–/]\s?([1-4]\d{3}))?(?:\s?(sr|elo)|(\+))?${NOT_BEFORE_WORD}`,
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

type RankToken = {
  start: number;
  end: number;
  min: number;
  max: number;
  openUp: boolean;
  openDown: boolean;
  /** Ancien SR en milliers sans libellé : rang seulement contre un rôle. */
  needsRole: boolean;
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

/** Rang d'un ancien SR : 500 points par palier, 100 par division, plafonné à Grand Maître 1. */
function srValue(sr: number): number {
  const steps = Math.floor((sr - 1000) / 100);
  return Math.min(GETI_TIERS.indexOf("GRANDMASTER") * DIVISIONS + DIVISIONS - 1, Math.max(0, steps));
}

function isYear(value: number): boolean {
  return value >= YEAR_MIN && value <= YEAR_MAX;
}

function tokenOf(match: RegExpExecArray, span: ValueRange, openUp = false, needsRole = false): RankToken {
  return { start: match.index, end: match.index + match[0].length, ...span, openUp, openDown: false, needsRole };
}

/** Paliers nommés, initiales collées à une division et « top 500 ». */
function tierTokens(lower: string): RankToken[] {
  const tokens: RankToken[] = [];
  for (const match of lower.matchAll(NAMED_RANK)) {
    const key = aliasKey(match[1]);
    const tier = TIER_TABLE.lookup.get(key);
    if (tier === undefined || (NEEDS_DIVISION.has(key) && match[2] === undefined)) continue;
    tokens.push(tokenOf(match, tierSpan(tier, match[2], match[3])));
  }
  for (const match of lower.matchAll(LETTER_RANK)) {
    const end = match.index + match[0].length;
    if (NOT_LETTER_RANK_BEFORE.test(lower.slice(Math.max(0, match.index - 12), match.index))) continue;
    if (NOT_LETTER_RANK_AFTER.test(lower.slice(end, end + 12))) continue;
    tokens.push(tokenOf(match, tierSpan(TIER_LETTERS[match[1]], match[2], match[3])));
  }
  for (const match of lower.matchAll(TOP_500)) {
    tokens.push(tokenOf(match, { min: GETI_TIERS.indexOf("GRANDMASTER") * DIVISIONS, max: GETI_RANK_TOP }));
  }
  return tokens;
}

/** Fourchette d'un SR en chiffres, `null` quand le nombre n'en est pas un (nu, ou deux années). */
function srNumberSpan(match: RegExpExecArray): ValueRange | null {
  const first = Number(match[1]);
  const second = match[2] === undefined ? first : Number(match[2]);
  const labelled = match[3] !== undefined || match[4] !== undefined;
  const alone = match[2] === undefined;
  if (!labelled && (alone || (isYear(first) && isYear(second)))) return null;
  const values = [srValue(first), srValue(second)];
  return { min: Math.min(...values), max: Math.max(...values) };
}

function isCounted(lower: string, match: RegExpExecArray): boolean {
  const end = match.index + match[0].length;
  return COUNTED_AFTER.test(lower.slice(end, end + 12));
}

/** Ancien SR, en milliers ou en chiffres. */
function srTokens(lower: string): RankToken[] {
  const tokens: RankToken[] = [];
  for (const match of lower.matchAll(SR_THOUSANDS)) {
    if ((match[2] !== undefined && match[3] !== undefined) || isCounted(lower, match)) continue;
    const value = srValue(Number(match[1]) * 1000 + Number(match[2] ?? match[3] ?? 0) * 100);
    // « 4k2 », « 3.9k » ne s'écrivent que pour un SR ; « 4k » seul est souvent un montant.
    const labelled =
      match[2] !== undefined ||
      match[3] !== undefined ||
      match[4] !== undefined ||
      SR_LABEL_BEFORE.test(lower.slice(Math.max(0, match.index - 6), match.index));
    tokens.push(tokenOf(match, { min: value, max: value }, false, !labelled));
  }
  for (const match of lower.matchAll(SR_NUMBER)) {
    const span = srNumberSpan(match);
    const notCounted = match[3] !== undefined || !isCounted(lower, match);
    if (span !== null && notCounted) tokens.push(tokenOf(match, span, match[4] !== undefined));
  }
  return tokens;
}

function rawTokens(lower: string): RankToken[] {
  return [...tierTokens(lower), ...srTokens(lower)];
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

function rankTokens(lower: string): RankToken[] {
  const sorted = rawTokens(lower).sort((a, b) => a.start - b.start || b.end - a.end);
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

/** Un SR en milliers sans libellé n'est un rang que contre un rôle (« tank 4k »). */
function isBesideRole(lower: string, token: RankToken, runs: readonly RoleRun[]): boolean {
  const before = runs.findLast((run) => run.end <= token.start);
  const after = runs.find((run) => run.start >= token.end);
  return (
    (before !== undefined && isRoleRankGap(lower.slice(before.end, token.start))) ||
    (after !== undefined && isRoleRankGap(lower.slice(token.end, after.start)))
  );
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
 * @returns Les rangs ; `min` et `max` valent `null` quand aucun rang n'est lu.
 */
export function parseGetiRanks(lower: string, roleTokens: readonly GetiRoleToken[]): GetiRanks {
  const runs = roleRuns(lower, roleTokens);
  const tokens = rankTokens(lower).filter((token) => !token.needsRole || isBesideRole(lower, token, runs));
  const groups = rankGroups(lower, tokens);
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
