/**
 * Champs secondaires d'une annonce GETI : région, plateforme, langues,
 * disponibilités, nom d'équipe, postes de staff, âge minimal, mot-clé de
 * catégorie.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import {
  NOT_AFTER_WORD,
  NOT_BEFORE_WORD,
  aliasKey,
  aliasTable,
  getiFlagCodes,
  inReferenceOrder,
  type GetiPreparedText,
} from "@/lib/shared/geti/normalize";
import {
  GETI_CATEGORIES,
  GETI_DAYS,
  GETI_LANGUAGES,
  GETI_PLATFORMS,
  GETI_REGIONS,
  GETI_STAFF_ROLES,
  type GetiAvailability,
  type GetiCategory,
  type GetiDay,
  type GetiLanguage,
  type GetiPlatform,
  type GetiRegion,
  type GetiStaffRole,
  type GetiTimeRange,
} from "@/lib/shared/geti/types";
import { visibleText } from "@/lib/shared/visible-text";

/** Lecteur des valeurs d'une table d'alias présentes dans un texte, dans l'ordre de référence. */
function aliasFinder<T extends string>(
  reference: readonly T[],
  groups: Readonly<Record<T, readonly string[]>>,
): (lower: string) => T[] {
  const table = aliasTable(groups);
  const pattern = new RegExp(`${NOT_AFTER_WORD}(${table.pattern})${NOT_BEFORE_WORD}`, "gu");
  return (lower) => {
    const found: T[] = [];
    for (const match of lower.matchAll(pattern)) {
      const value = table.lookup.get(aliasKey(match[1]));
      if (value !== undefined) found.push(value);
    }
    return inReferenceOrder(reference, found);
  };
}

const REGION_ALIASES: Readonly<Record<GetiRegion, readonly string[]>> = {
  // « eu » seul est lu à part : c'est aussi le participe d'« avoir » (« j'ai eu »).
  EU: ["euw", "eune", "europe", "european", "europeen", "europeenne", "emea"],
  NA: ["na", "nae", "naw", "north america", "amerique du nord"],
  LATAM: ["latam", "south america", "latin america", "amerique du sud", "amerique latine"],
  ASIA: ["asia", "asie", "apac", "korea", "coree", "kr"],
  OCE: ["oce", "oceania", "oceanie", "australia", "australie"],
};

const findRegions = aliasFinder(GETI_REGIONS, REGION_ALIASES);
const EU_WORD = new RegExp(String.raw`${NOT_AFTER_WORD}eu${NOT_BEFORE_WORD}`, "gu");
/** Mots qui font de « eu » le participe d'« avoir » : « j'ai eu », « on a eu », « jamais eu ». */
const AVOIR_FORMS = [
  "ai as a avons avez ont avais avait avions aviez avaient aurai auras aura aurons aurez auront",
  "aurais aurait aurions auriez auraient aie aies ait ayons ayez aient avoir ayant",
].join(" ");
const PARTICIPLE_BEFORE = new Set(
  [AVOIR_FORMS, "pas jamais deja toujours enfin souvent rien beaucoup trop presque vraiment"].join(" ").split(" "),
);
const AVOIR = new Set(AVOIR_FORMS.split(" "));
/**
 * Adverbes aussi courants devant la région (« plus EU que NA », « tout EU ») :
 * « eu » n'est le participe que derrière une forme d'« avoir » (« j'ai bien eu »).
 */
const AMBIGUOUS_ADVERBS = new Set(["bien", "plus", "tout", "assez"]);
/**
 * « a » (accents ôtés, « à » s'y confond) n'est l'auxiliaire que derrière son
 * sujet : « il a eu », « on a eu », mais « de NA à EU ».
 */
const A_SUBJECTS = new Set(["il", "elle", "on", "qui", "ca", "cela", "y", "n"]);
const WORDS_BEFORE = /(?:(\p{L}+)[^\p{L}\p{N}\n]+)?(\p{L}+)[^\p{L}\p{N}\n]*$/u;

function isParticiple(before: string): boolean {
  const words = WORDS_BEFORE.exec(before);
  if (words === null) return false;
  const [, subject, previous] = words;
  if (previous === "a") return subject !== undefined && A_SUBJECTS.has(subject);
  // « à tout EU » : derrière « a », l'adverbe reste ambigu et la région l'emporte.
  if (AMBIGUOUS_ADVERBS.has(previous)) return subject !== undefined && subject !== "a" && AVOIR.has(subject);
  return PARTICIPLE_BEFORE.has(previous);
}

/** « eu » est la région, sauf derrière un auxiliaire ou un adverbe (« j'ai eu une team »). */
function hasEuWord(lower: string): boolean {
  for (const match of lower.matchAll(EU_WORD)) {
    if (!isParticiple(lower.slice(Math.max(0, match.index - 30), match.index))) return true;
  }
  return false;
}

/**
 * Régions visées (mêmes mots que le relais du bot, Océanie en plus).
 *
 * @param lower Texte sans accents, en minuscules.
 * @param rawText Texte d'origine, où lire le drapeau européen.
 * @returns Les régions, dans l'ordre de `GETI_REGIONS`.
 */
export function parseGetiRegions(lower: string, rawText: string): GetiRegion[] {
  const found = findRegions(lower);
  const europe = hasEuWord(lower) || getiFlagCodes(rawText).includes("EU");
  return europe ? inReferenceOrder(GETI_REGIONS, [...found, "EU"]) : found;
}

const PLATFORM_ALIASES: Readonly<Record<GetiPlatform, readonly string[]>> = {
  PC: ["pc"],
  // « switch » seul est aussi un verbe (« switch de rôle ») : non retenu.
  CONSOLE: ["console", "consoles", "ps4", "ps5", "playstation", "psn", "xbox", "nintendo switch"],
};

const findPlatforms = aliasFinder(GETI_PLATFORMS, PLATFORM_ALIASES);

/**
 * Plateformes citées.
 *
 * @param lower Texte sans accents, en minuscules.
 * @returns Les plateformes, dans l'ordre de `GETI_PLATFORMS`.
 */
export function parseGetiPlatforms(lower: string): GetiPlatform[] {
  return findPlatforms(lower);
}

const LANGUAGE_ALIASES: Readonly<Record<GetiLanguage, readonly string[]>> = {
  FR: ["fr", "fra", "francais", "francaise", "french", "francophone", "francophones"],
  EN: ["eng", "english", "anglais", "anglaise", "anglophone", "anglophones"],
  ES: ["spanish", "espagnol", "espanol"],
  DE: ["german", "allemand", "deutsch"],
  IT: ["italian", "italien", "italiano"],
  PT: ["portuguese", "portugais", "portugues"],
  NL: ["dutch", "neerlandais", "nederlands"],
  PL: ["polish", "polonais", "polski"],
  AR: ["arabic", "arabe"],
};

const findLanguageWords = aliasFinder(GETI_LANGUAGES, LANGUAGE_ALIASES);

const LANGUAGE_FLAGS: Readonly<Record<string, GetiLanguage>> = {
  FR: "FR",
  GB: "EN",
  US: "EN",
  ES: "ES",
  DE: "DE",
  IT: "IT",
  PT: "PT",
  BR: "PT",
  NL: "NL",
  PL: "PL",
};

const LANGUAGE_CODES = GETI_LANGUAGES.join("|");
/**
 * Sigles en capitales, en liste seulement (« FR/EN ») : seuls, « EN », « ES »
 * ou « DE » sont des mots courants.
 */
const LANGUAGE_CODE_LIST = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:${LANGUAGE_CODES})(?:\s?[/,&+-]\s?(?:${LANGUAGE_CODES}))+${NOT_BEFORE_WORD}`,
  "gu",
);
/** Sigle derrière un libellé : « langue : en », « languages: FR ». */
const LANGUAGE_LABEL = new RegExp(
  String.raw`${NOT_AFTER_WORD}lang(?:ue|ues|uage|uages)?\s?[:=]\s?([a-z]{2})${NOT_BEFORE_WORD}`,
  "gu",
);

function isLanguage(code: string): code is GetiLanguage {
  return (GETI_LANGUAGES as readonly string[]).includes(code);
}

/**
 * Langues parlées : mots (« francophone », « english »), sigles en liste ou
 * derrière un libellé, drapeaux.
 *
 * @param prepared Formes d'analyse du texte.
 * @param rawText Texte d'origine, où lire les drapeaux.
 * @returns Les langues, dans l'ordre de `GETI_LANGUAGES`.
 */
export function parseGetiLanguages(prepared: GetiPreparedText, rawText: string): GetiLanguage[] {
  const found: GetiLanguage[] = findLanguageWords(prepared.lower);
  for (const list of prepared.plain.matchAll(LANGUAGE_CODE_LIST)) {
    found.push(...list[0].split(/[^A-Z]+/u).filter(isLanguage));
  }
  for (const label of prepared.lower.matchAll(LANGUAGE_LABEL)) {
    const code = label[1].toUpperCase();
    if (isLanguage(code)) found.push(code);
  }
  for (const flag of getiFlagCodes(rawText)) {
    const language = LANGUAGE_FLAGS[flag];
    if (language !== undefined) found.push(language);
  }
  return inReferenceOrder(GETI_LANGUAGES, found);
}

/** Noms complets seulement : « mar », « jeu », « mon » ou « sun » sont des mots courants. */
const DAY_ALIASES: Readonly<Record<GetiDay, readonly string[]>> = {
  MON: ["lundi", "lundis", "monday", "mondays"],
  TUE: ["mardi", "mardis", "tuesday", "tuesdays"],
  WED: ["mercredi", "mercredis", "wednesday", "wednesdays"],
  THU: ["jeudi", "jeudis", "thursday", "thursdays"],
  FRI: ["vendredi", "vendredis", "friday", "fridays"],
  SAT: ["samedi", "samedis", "saturday", "saturdays"],
  SUN: ["dimanche", "dimanches", "sunday", "sundays"],
};
const DAY_TABLE = aliasTable(DAY_ALIASES);
const DAY_RANGE = new RegExp(
  String.raw`${NOT_AFTER_WORD}(${DAY_TABLE.pattern})\s?(?:-|–|au|a|to|jusqu'?\s?au)\s?(${DAY_TABLE.pattern})${NOT_BEFORE_WORD}`,
  "gu",
);
const DAY_SINGLE = new RegExp(`${NOT_AFTER_WORD}(${DAY_TABLE.pattern})${NOT_BEFORE_WORD}`, "gu");
const WEEKDAYS = new RegExp(String.raw`${NOT_AFTER_WORD}(?:en semaine|la semaine|weekdays?)${NOT_BEFORE_WORD}`, "u");
const WEEKEND = new RegExp(String.raw`${NOT_AFTER_WORD}(?:week[\s-]?ends?)${NOT_BEFORE_WORD}`, "u");
const EVERY_DAY = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:tous les jours|tous les soirs|chaque jour|chaque soir|every\s?day|every evening|7j/7|7/7)${NOT_BEFORE_WORD}`,
  "u",
);

function parseDays(lower: string): GetiDay[] {
  const found: GetiDay[] = [];
  const dayOf = (text: string) => DAY_TABLE.lookup.get(aliasKey(text));
  for (const range of lower.matchAll(DAY_RANGE)) {
    const from = dayOf(range[1]);
    const to = dayOf(range[2]);
    if (from === undefined || to === undefined) continue;
    // Une fourchette traverse la semaine : « vendredi au lundi » passe par le week-end.
    for (let index = GETI_DAYS.indexOf(from); ; index = (index + 1) % GETI_DAYS.length) {
      found.push(GETI_DAYS[index]);
      if (GETI_DAYS[index] === to) break;
    }
  }
  for (const single of lower.matchAll(DAY_SINGLE)) {
    const day = dayOf(single[1]);
    if (day !== undefined) found.push(day);
  }
  if (WEEKDAYS.test(lower)) found.push("MON", "TUE", "WED", "THU", "FRI");
  if (WEEKEND.test(lower)) found.push("SAT", "SUN");
  if (EVERY_DAY.test(lower)) found.push(...GETI_DAYS);
  return inReferenceOrder(GETI_DAYS, found);
}

// Espaces simples seulement : une heure ne se lit pas à cheval sur deux lignes
// (« 21h-23h » puis « 18+ » à la ligne ne font pas « 23h18 »).
const TIME_SEPARATOR = String.raw` ?(?:-|–|—|a|au|to|>|→|/|jusqu'? ?a|until) ?`;
/** Heure écrite : « 20h », « 20h30 », « 20 heures », « 20:30 », « 8pm », « 8:30 pm ». */
const TIME_ATOM = String.raw`(\d{1,2})(?: ?(h(?:eures?)?) ?(\d{2})?|:(\d{2}))? ?(am|pm)?`;
const TIME_ATOM_GROUPS = 5;
/** Fourchette ; la première heure peut ne pas porter d'unité : « 20-23h », « 8-11pm ». */
const TIME_RANGE = new RegExp(
  String.raw`(?<![\p{L}\p{N}:#+])${TIME_ATOM}${TIME_SEPARATOR}${TIME_ATOM}${NOT_BEFORE_WORD}`,
  "gu",
);
const TIME_SINGLE = new RegExp(String.raw`(?<![\p{L}\p{N}:#+])${TIME_ATOM}${NOT_BEFORE_WORD}`, "gu");
/** Une durée n'est pas une heure : « 2h par jour », « 3h de jeu » (pas « parfois », « partout »). */
const DURATION_AFTER =
  /^\s?(?:par(?!\p{L})|de jeu|de scrim|per(?!\p{L})|a day|\/\s?(?:jour|soir|day|night|semaine|week))/u;
/** Au-delà, deux heures écrites (« 20h-23h par soir ») sont une plage horaire, pas une durée. */
const DURATION_HOURS_MAX = 6;

type TimeParts = {
  hour: number;
  minutes: number;
  meridiem: string | undefined;
  /** L'heure porte sa propre unité (« h », « : », am/pm). */
  explicit: boolean;
};

function timeParts(match: RegExpMatchArray, offset: number): TimeParts {
  const [hour, hourUnit, hourMinutes, colonMinutes, meridiem] = match.slice(offset, offset + TIME_ATOM_GROUPS);
  return {
    hour: Number(hour),
    minutes: Number(hourMinutes ?? colonMinutes ?? 0),
    meridiem,
    explicit: hourUnit !== undefined || colonMinutes !== undefined || meridiem !== undefined,
  };
}

function toMinutes(parts: TimeParts, meridiem: string | undefined): number | null {
  let hour = parts.hour;
  if (parts.minutes >= 60) return null;
  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 24 || (hour === 24 && parts.minutes > 0)) return null;
  return hour * 60 + parts.minutes;
}

/** « 2-3h par soir », « 2h par jour » : une durée, ni lue ni relue heure par heure. */
function isDuration(lower: string, end: number): boolean {
  return DURATION_AFTER.test(lower.slice(end, end + 12));
}

/**
 * Une fourchette devant « par jour » est une durée si ses deux bornes sont de
 * petits nombres d'heures (« 2-3h », « 1h-2h ») ; « 20h-23h par soir » et
 * « 20-23h par soir » restent des plages horaires.
 */
function isDurationRange(lower: string, end: number, first: TimeParts, second: TimeParts): boolean {
  if (!isDuration(lower, end)) return false;
  const plain = (parts: TimeParts) => parts.meridiem === undefined && parts.hour <= DURATION_HOURS_MAX;
  return plain(first) && plain(second);
}

function timeRange(first: TimeParts, second: TimeParts): GetiTimeRange | null {
  const from = toMinutes(first, first.meridiem ?? second.meridiem);
  const to = toMinutes(second, second.meridiem);
  return from === null || to === null ? null : { from, to };
}

/** Fourchettes horaires, et le texte où elles (et les durées) sont effacées. */
function parseTimeRanges(lower: string): { times: GetiTimeRange[]; rest: string } {
  const times: GetiTimeRange[] = [];
  let rest = lower;
  for (const match of lower.matchAll(TIME_RANGE)) {
    const first = timeParts(match, 1);
    const second = timeParts(match, 1 + TIME_ATOM_GROUPS);
    // « 3-5 joueurs » : sans unité sur la seconde heure, ce n'est pas un horaire.
    if (!second.explicit) continue;
    const end = match.index + match[0].length;
    const range = isDurationRange(lower, end, first, second) ? "duration" : timeRange(first, second);
    if (range === null) continue;
    if (range !== "duration") times.push(range);
    // La fourchette lue est effacée : ses heures ne se relisent pas une à une.
    rest = rest.slice(0, match.index) + " ".repeat(match[0].length) + rest.slice(end);
  }
  return { times, rest };
}

function parseTimes(lower: string): GetiTimeRange[] {
  const { times, rest } = parseTimeRanges(lower);
  for (const match of rest.matchAll(TIME_SINGLE)) {
    const parts = timeParts(match, 1);
    if (!parts.explicit) continue;
    if (isDuration(rest, match.index + match[0].length)) continue;
    const from = toMinutes(parts, parts.meridiem);
    if (from !== null) times.push({ from, to: null });
  }
  return uniqueSortedTimes(times);
}

function uniqueSortedTimes(times: readonly GetiTimeRange[]): GetiTimeRange[] {
  const seen = new Set<string>();
  return times
    .filter((time) => {
      const key = `${time.from}-${time.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.from - b.from || (a.to ?? -1) - (b.to ?? -1));
}

/** Sigles de fuseau lus en capitales seulement (« est » est un mot français). */
const TIMEZONE_CODE = /(?<![\p{L}\p{N}])(CEST|CET|(?:UTC|GMT)(?:\s?[+-]\s?\d{1,2})?)(?![\p{L}\p{N}])/u;
const PARIS_TIME = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:heure francaise|heure de paris|heure de france|french time|paris time)${NOT_BEFORE_WORD}`,
  "u",
);

function parseTimezone(prepared: GetiPreparedText): string | null {
  if (PARIS_TIME.test(prepared.lower)) return "Europe/Paris";
  const code = TIMEZONE_CODE.exec(prepared.plain);
  return code === null ? null : code[1].replace(/\s/gu, "");
}

/**
 * Disponibilités : jours cités, horaires (minutes depuis minuit) et fuseau.
 *
 * @param prepared Formes d'analyse du texte.
 * @returns Les disponibilités, listes vides quand rien n'est lu.
 */
export function parseGetiAvailability(prepared: GetiPreparedText): GetiAvailability {
  return {
    days: parseDays(prepared.lower),
    times: parseTimes(prepared.lower),
    timezone: parseTimezone(prepared),
  };
}

const STAFF_ALIASES: Readonly<Record<GetiStaffRole, readonly string[]>> = {
  COACH: ["coach", "coachs", "coaches", "coaching", "head coach", "assistant coach"],
  MANAGER: ["manager", "managers", "manageur", "manageurs", "manageuse", "team manager"],
  ANALYST: ["analyst", "analysts", "analyste", "analystes"],
  CASTER: [
    "caster",
    "casters",
    "casteur",
    "casteurs",
    "casteuse",
    "shoutcaster",
    "commentateur",
    "commentateurs",
    "commentatrice",
    "commentator",
    "commentators",
  ],
  OBSERVER: ["observer", "observers", "observateur", "observateurs"],
  GRAPHIC: ["graphiste", "graphistes", "graphic designer", "designer", "gfx"],
  COMMUNITY: ["community manager", "cm"],
};

const findStaffRoles = aliasFinder(GETI_STAFF_ROLES, STAFF_ALIASES);

/**
 * Postes de staff cités (« coach », « manager », « caster »…).
 *
 * @param lower Texte sans accents, en minuscules.
 * @returns Les postes, dans l'ordre de `GETI_STAFF_ROLES`.
 */
export function parseGetiStaffRoles(lower: string): GetiStaffRole[] {
  return findStaffRoles(lower);
}

const AGE = String.raw`(1[3-9]|2[0-5])`;
/**
 * Derrière « 18+ » ou « +18 » sans mot d'âge : la fin, une ponctuation, un mot
 * d'âge, ou un mot d'annonce (rôle, région, langue, plateforme : « 18+ dps »,
 * « +18 FR »). « +20 joueurs », « +15 min » ou « 20+ inscrits » sont des nombres.
 */
const AGE_FOLLOW = new RegExp(
  String.raw`^[^\S\n]*(?:$|[^\p{L}\p{N}\s]|\n|(?:ans?|yo|y/o|years?|old|only|seulement|uniquement|obligatoire|requis|required|minimum|mini|svp|pls|please|et|and|tank|tanks|dps|supp?|supports?|heal|heals|healers?|flex|fr|eu|na|eng?|euw|francais|francaise|francophones?|english|anglophones?|pc|console|ps5|xbox|team|equipe|lfp|lft|lfs|lfsub|lfstaff|lfcast)${NOT_BEFORE_WORD})`,
  "u",
);
/** … et pas derrière un mot qui en fait un niveau ou un délai : « lvl 20+ », « dans +15 min ». */
const NOT_AGE_BEFORE = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:lvl|lv|level|niveau|niv|top|rang|rank|dans|in|within)\s?:?\s?$`,
  "u",
);
type AgePattern = { pattern: RegExp; unlabelled: boolean };
const MIN_AGE_PATTERNS: readonly AgePattern[] = [
  { pattern: new RegExp(String.raw`${NOT_AFTER_WORD}${AGE}\s?\+`, "gu"), unlabelled: true },
  { pattern: new RegExp(String.raw`(?<![\p{L}\p{N}:])\+\s?${AGE}${NOT_BEFORE_WORD}`, "gu"), unlabelled: true },
  {
    pattern: new RegExp(
      String.raw`${NOT_AFTER_WORD}${AGE}\s?(?:ans|yo|y/o|years old|years)\s?(?:min|minimum|mini|ou plus|et plus|or older|and older|and up)${NOT_BEFORE_WORD}`,
      "gu",
    ),
    unlabelled: false,
  },
  {
    pattern: new RegExp(
      String.raw`${NOT_AFTER_WORD}(?:min|minimum|au moins|at least)\s?:?\s?${AGE}\s?(?:ans|yo|y/o|years)${NOT_BEFORE_WORD}`,
      "gu",
    ),
    unlabelled: false,
  },
];
const ADULT = new RegExp(String.raw`${NOT_AFTER_WORD}(?:majeure?s?|adults? only)${NOT_BEFORE_WORD}`, "u");
const ADULT_AGE = 18;

/**
 * Âge minimal : « 18+ », « +16 », « 17 ans minimum », « majeur ».
 *
 * @param lower Texte sans accents, en minuscules.
 * @returns L'âge, ou `null`.
 */
export function parseGetiMinAge(lower: string): number | null {
  for (const { pattern, unlabelled } of MIN_AGE_PATTERNS) {
    for (const match of lower.matchAll(pattern)) {
      if (!unlabelled) return Number(match[1]);
      const end = match.index + match[0].length;
      const before = lower.slice(Math.max(0, match.index - 12), match.index);
      if (AGE_FOLLOW.test(lower.slice(end, end + 16)) && !NOT_AGE_BEFORE.test(before)) return Number(match[1]);
    }
  }
  return ADULT.test(lower) ? ADULT_AGE : null;
}

export const GETI_TEAM_NAME_MAX = 40;
const TEAM_WORD = String.raw`(?:[Tt]eam|TEAM|[Éé]quipe|[Ee]quipe|[ÉE]QUIPE|[Ss]tructure|STRUCTURE|[Rr]oster|ROSTER)`;
const TEAM_NOUN = "[ée]quipe|team|structure";
/** Libellés d'un nom d'équipe : « Nom de l'équipe », « Team name », « Équipe », « Roster ». */
const TEAM_LABEL_WORDS = String.raw`nom\s+(?:de\s+(?:la\s+|l'\s?)?|d'\s?)?(?:${TEAM_NOUN})|team\s*name|${TEAM_NOUN}|roster`;
const TEAM_LABEL = new RegExp(String.raw`^[ \t]*(?:${TEAM_LABEL_WORDS})\s?[:=]\s?(.{1,80})$`, "imu");
const NAME_TOKEN = String.raw`[\p{Lu}\p{N}][\p{L}\p{N}'.-]*`;
const TEAM_INLINE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])${TEAM_WORD} +(${NAME_TOKEN}(?: +${NAME_TOKEN}){0,2})`,
  "gu",
);
/** Fin d'un nom derrière un libellé : première ponctuation de séparation. */
const LABEL_END = /\s[-–—]\s|[,;•·(\[]|\s{2,}/u;

/**
 * Mots qui ne font pas un nom d'équipe : vocabulaire de l'annonce (rangs,
 * rôles, régions, sigles) et verbes qui suivent « team » dans une phrase.
 */
const NOT_A_NAME = new Set(
  [
    "fr eu na en pc ow ow2 overwatch lfp lft lfs lfsub lfstaff lfcast",
    "bronze silver gold plat platine platinum diam diamant diamond master masters gm grandmaster champion top500",
    "tank dps support supp heal flex console ps5 xbox",
    "cherche recherche recrute looking seeking need needs is are est qui de du des en a au and et for pour",
    "competitive competitif compet chill serieuse serieux tryhard semi francaise francophone",
    "name nom discord role roles rang rank region plateforme platform contact",
    "je j nous il elle ils elles vous tu notre nos votre vos mon ma mes",
  ]
    .join(" ")
    .split(" "),
);
/**
 * Pronoms : un nom en capitales peut en finir un (« Team Game I », « Team Game
 * On », « Team Not You ») s'il en est le dernier mot et qu'un verbe de sa langue
 * ne le suit pas (« Team Phoenix We are looking », « Team Nova I need »,
 * « team Phoenix On cherche ») ; il n'en ouvre jamais un (« team We are looking »).
 */
const ENGLISH_PRONOUNS = new Set(["we", "i", "you", "they", "he", "she", "my", "our", "your"]);
const FRENCH_PRONOUNS = new Set(["on"]);
const ENGLISH_VERB_AFTER = new RegExp(
  String.raw`^[^\S\n]+(?:'m|'re|am|are|is|was|were|need|needs|want|wants|have|has|had|look|looking|search|searching|seek|seeking|play|plays|recruit|recruiting|will|can|could|would|do|don't|just|also|still|really)(?![\p{L}\p{N}])`,
  "u",
);
const FRENCH_VERB_AFTER = new RegExp(
  String.raw`^[^\S\n]+(?:(?:cherche|recherche|recrute|veut|est|a|joue|vise|propose|attend|accepte|prend|organise|monte|lance|ouvre|peut|va|ne|se|y|en)(?![\p{L}\p{N}])|n'|s')`,
  "u",
);

function nameKey(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Dans la phrase, un article derrière « team » ouvre une phrase (« team la plus
 * chill », « team La plus chill »), pas un nom — sauf en capitale devant un mot
 * en capitale (« team La Horde », « équipe The Owls »).
 */
const LEADING_ARTICLES = new Set(["le", "la", "les", "l", "un", "une", "des", "the", "a", "an", "ce", "cette", "this"]);
const CAPITALISED = /^\p{Lu}/u;

function opensSentence(candidate: string): boolean {
  const [first = "", second = ""] = candidate.split(/\s+/u).filter((word) => word !== "");
  if (!LEADING_ARTICLES.has(nameKey(first))) return false;
  return !(CAPITALISED.test(first) && CAPITALISED.test(second));
}

/** Verbe qui, derrière ce pronom, en fait le sujet d'une phrase ; `null` pour un mot qui n'est pas un pronom. */
function verbAfterPronoun(key: string): RegExp | null {
  if (ENGLISH_PRONOUNS.has(key)) return ENGLISH_VERB_AFTER;
  return FRENCH_PRONOUNS.has(key) ? FRENCH_VERB_AFTER : null;
}

/** Position d'un mot dans le nom candidat, et ce qui suit ce nom dans le texte. */
type NameWordPlace = { index: number; last: boolean; following: string };

function isNameWord(word: string, place: NameWordPlace): boolean {
  const key = nameKey(word);
  if (key === "" || NOT_A_NAME.has(key) || /^[bsgpdmc][1-5]$/u.test(key)) return false;
  const verbAfter = verbAfterPronoun(key);
  if (verbAfter === null) return true;
  return place.index > 0 && place.last && CAPITALISED.test(word) && !verbAfter.test(place.following);
}

/**
 * @param candidate Mots lus derrière « team » ou le libellé.
 * @param following Texte qui suit le candidat (vide derrière un libellé).
 */
function cleanTeamName(candidate: string, following = ""): string | null {
  const words = candidate.split(/\s+/u).filter((word) => word !== "");
  // Le nom s'arrête au premier mot du vocabulaire d'annonce : « Blue Phoenix EU ».
  const stop = words.findIndex(
    (word, index) => !isNameWord(word, { index, last: index === words.length - 1, following }),
  );
  const kept = stop === -1 ? words : words.slice(0, stop);
  const name = visibleText(kept.join(" ")).replace(/[.'-]+$/u, "");
  // Mots en capitale seulement : « 5 joueurs dont 2 tanks » n'est pas un nom.
  if (!/\p{Lu}/u.test(name)) return null;
  return name.length > GETI_TEAM_NAME_MAX ? null : name;
}

/**
 * Nom d'équipe : derrière un libellé (« Équipe : Blue Phoenix ») ou dans la
 * phrase (« la team Blue Phoenix recherche »), mots en capitale seulement.
 * Texte non fiable : rendu par `visibleText`, borné, jamais interprété.
 *
 * @param clean Texte à la casse et aux accents gardés (`prepareGetiText`).
 * @returns Le nom, ou `null` quand rien de net n'est lu.
 */
export function parseGetiTeamName(clean: string): string | null {
  const label = TEAM_LABEL.exec(clean);
  if (label !== null) {
    const name = cleanTeamName(label[1].split(LABEL_END)[0]);
    if (name !== null) return name;
  }
  for (const match of clean.matchAll(TEAM_INLINE)) {
    if (opensSentence(match[1])) continue;
    const end = match.index + match[0].length;
    const name = cleanTeamName(match[1], clean.slice(end, end + 16));
    if (name !== null) return name;
  }
  return null;
}

const CATEGORY_KEYWORD = new RegExp(
  `${NOT_AFTER_WORD}(${[...GETI_CATEGORIES].sort((a, b) => b.length - a.length).join("|")})${NOT_BEFORE_WORD}`,
  "gu",
);

/**
 * Catégorie d'après le mot-clé du relais (« lfp », « lft »…) : celle du seul
 * mot-clé présent, `null` s'il n'y en a aucun ou plusieurs différents.
 *
 * @param lower Texte sans accents, en minuscules.
 * @returns La catégorie, ou `null`.
 */
export function detectGetiCategory(lower: string): GetiCategory | null {
  const found = new Set<GetiCategory>();
  for (const match of lower.matchAll(CATEGORY_KEYWORD)) {
    const keyword = GETI_CATEGORIES.find((category) => category === match[1]);
    if (keyword !== undefined) found.add(keyword);
  }
  const [only] = found;
  return found.size === 1 ? only : null;
}
