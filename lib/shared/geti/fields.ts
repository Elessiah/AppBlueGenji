/**
 * Champs secondaires d'une annonce GETI : région, plateforme, langues,
 * disponibilités, dates, niveau de division, nom d'équipe, postes de staff,
 * âge minimal, mot-clé de catégorie.
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
  GETI_LEVELS,
  GETI_PLATFORMS,
  GETI_REGIONS,
  GETI_STAFF_ROLES,
  type GetiAvailability,
  type GetiCategory,
  type GetiDay,
  type GetiLanguage,
  type GetiLevel,
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
const PARTICIPLE_BEFORE = new Set(
  [
    "ai as a avons avez ont avais avait avions aviez avaient aurai auras aura aurons aurez auront",
    "aurais aurait aurions auriez auraient aie aies ait ayons ayez aient avoir ayant",
    "pas jamais deja toujours enfin souvent rien beaucoup trop presque vraiment",
  ]
    .join(" ")
    .split(" "),
);
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
/** Équipe qui mêle PC et console : les deux plateformes. */
const BOTH_PLATFORMS = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:hybrid|hybride|hybrides|cross[\s-]?play|cross[\s-]?plate?form|cross[\s-]?plateforme)${NOT_BEFORE_WORD}`,
  "u",
);
/** « mixed », dans une recherche de scrim, dit la même chose ; ailleurs, c'est une équipe mixte. */
const MIXED = new RegExp(String.raw`${NOT_AFTER_WORD}mixed${NOT_BEFORE_WORD}`, "u");

/**
 * Plateformes citées ; « hybrid », « crossplay » (et « mixed » pour un scrim)
 * valent PC **et** console.
 *
 * @param lower Texte sans accents, en minuscules.
 * @param scrim `true` pour une recherche de scrim (`lfs`).
 * @returns Les plateformes, dans l'ordre de `GETI_PLATFORMS`.
 */
export function parseGetiPlatforms(lower: string, scrim = false): GetiPlatform[] {
  if (BOTH_PLATFORMS.test(lower) || (scrim && MIXED.test(lower))) return [...GETI_PLATFORMS];
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

/** Noms complets (fautes courantes comprises) ; les abréviations se lisent à part, en contexte. */
const DAY_ALIASES: Readonly<Record<GetiDay, readonly string[]>> = {
  MON: ["lundi", "lundis", "monday", "mondays"],
  TUE: ["mardi", "mardis", "tuesday", "tuesdays"],
  WED: ["mercredi", "mercredis", "mecredi", "mercedi", "wednesday", "wednesdays", "wenesday", "wednesay"],
  THU: ["jeudi", "jeudis", "thursday", "thursdays", "thurday"],
  FRI: ["vendredi", "vendredis", "friday", "fridays"],
  SAT: ["samedi", "samedis", "saturday", "saturdays"],
  SUN: ["dimanche", "dimanches", "sunday", "sundays"],
};
/**
 * Abréviations : « mar », « jeu », « mon » ou « sun » sont aussi des mots
 * courants — lues seulement devant une date ou une heure (« Tue 20-22 »,
 * « sam 28/11 », « ven. 21h ») ou en liste ponctuée (« lun/mer/ven »,
 * « mon-fri ») ; « mon jeu » reste « mon jeu ».
 */
const DAY_ABBREVIATIONS: Readonly<Record<GetiDay, readonly string[]>> = {
  MON: ["lun", "mon"],
  TUE: ["mar", "tue", "tues"],
  WED: ["mer", "wed"],
  THU: ["jeu", "thu", "thur", "thurs"],
  FRI: ["ven", "fri"],
  SAT: ["sam", "sat"],
  SUN: ["dim", "sun"],
};
const DAY_ABBREVIATION_TABLE = aliasTable(DAY_ABBREVIATIONS);
const ABBREVIATION = `(${DAY_ABBREVIATION_TABLE.pattern})`;
const DAY_ABBREVIATION_DATED = new RegExp(
  String.raw`${NOT_AFTER_WORD}${ABBREVIATION}\.?\s?:?\s?(?=\d{1,2}\s?(?:[/h:–-]\s?\d|h${NOT_BEFORE_WORD}))`,
  "gu",
);
const DAY_ABBREVIATION_LIST = new RegExp(
  String.raw`${NOT_AFTER_WORD}${ABBREVIATION}\.?\s?[/,&–-]\s?${ABBREVIATION}\.?(?:\s?[/,&–-]\s?${ABBREVIATION}\.?)*${NOT_BEFORE_WORD}`,
  "gu",
);
const DAY_ABBREVIATION_WORD = new RegExp(`${NOT_AFTER_WORD}${ABBREVIATION}${NOT_BEFORE_WORD}`, "gu");
const DAY_TABLE = aliasTable(DAY_ALIASES);
const DAY_RANGE = new RegExp(
  // Sur une ligne : « - Mardi » puis « - Dimanche » à la ligne sont deux jours, pas une fourchette.
  String.raw`${NOT_AFTER_WORD}(${DAY_TABLE.pattern})[^\S\n]?(?:-|–|au|a|to|jusqu'?[^\S\n]?au)[^\S\n]?(${DAY_TABLE.pattern})${NOT_BEFORE_WORD}`,
  "gu",
);
const DAY_SINGLE = new RegExp(`${NOT_AFTER_WORD}(${DAY_TABLE.pattern})${NOT_BEFORE_WORD}`, "gu");
const WEEKDAYS = new RegExp(String.raw`${NOT_AFTER_WORD}(?:en semaine|la semaine|weekdays?)${NOT_BEFORE_WORD}`, "u");
const WEEKEND = new RegExp(String.raw`${NOT_AFTER_WORD}(?:week[\s-]?ends?)${NOT_BEFORE_WORD}`, "u");
const EVERY_DAY = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:tous les jours|tous les soirs|chaque jour|chaque soir|every\s?day|every evening|7\s?j?\s?/\s?7\s?(?:j|jours?|days?)?)${NOT_BEFORE_WORD}`,
  "u",
);

/** Jours abrégés lus en contexte : devant une date ou une heure, ou en liste. */
function abbreviatedDays(lower: string): GetiDay[] {
  const found: GetiDay[] = [];
  const dayOf = (text: string) => DAY_ABBREVIATION_TABLE.lookup.get(aliasKey(text));
  for (const dated of lower.matchAll(DAY_ABBREVIATION_DATED)) {
    const day = dayOf(dated[1]);
    if (day !== undefined) found.push(day);
  }
  for (const list of lower.matchAll(DAY_ABBREVIATION_LIST)) {
    const days = [...list[0].matchAll(DAY_ABBREVIATION_WORD)].flatMap((word) => dayOf(word[1]) ?? []);
    // « lun-ven », « mon-fri » : la fourchette entière.
    if (days.length === 2 && /^\p{L}+\.?\s?[–-]/u.test(list[0])) {
      for (let index = GETI_DAYS.indexOf(days[0]); ; index = (index + 1) % GETI_DAYS.length) {
        found.push(GETI_DAYS[index]);
        if (GETI_DAYS[index] === days[1]) break;
      }
    } else if (new Set(days).size > 1) {
      // Deux abréviations différentes au moins : « sun sun » ou « mer mer » ne sont pas des jours.
      found.push(...days);
    }
  }
  return found;
}

function parseDays(lower: string): GetiDay[] {
  const found: GetiDay[] = abbreviatedDays(lower);
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
/** Fuseau écrit derrière un horaire, en minuscules dans le texte préparé. */
const ZONE_AFTER_PATTERN = new RegExp(String.raw`^ ?\(?(?:cest|cet|utc|gmt|bst|eet)${NOT_BEFORE_WORD}`, "u");
/**
 * Fourchette sans unité, la forme des recherches de scrim : « 20-22 CET »,
 * « 21 - 23 », « 21/23 CET », « 21.15-23 CET », « h21-23 », « 20-22cest ».
 * Sans fuseau derrière, elle n'est lue qu'en soirée (à partir de 13 h au
 * tiret, de 19 h à la barre oblique) : « 3-5 joueurs », « 22/11 » ou
 * « 15/20 » ne sont pas des horaires.
 */
const UNITLESS_RANGE = new RegExp(
  String.raw`(?<![\p{L}\p{N}:#+.,/–-])h?(\d{1,2})(?:[.:](\d{2}))? ?([-–/]) ?(\d{1,2})(?:[.:](\d{2}))?(?!\p{N}|(?!ces?t${NOT_BEFORE_WORD})\p{L}|[.,:/–-]\p{N})`,
  "gu",
);
/** Sans fuseau, la barre oblique ne se lit qu'en fin de soirée : « 21/23 », pas « 15/20 ». */
const SLASH_FROM_HOUR = 19;
const SLASH_SPAN_MAX_HOURS = 4;
/** Heure seule sans unité, devant son fuseau : « 20 CET ». */
const UNITLESS_SINGLE = new RegExp(
  String.raw`(?<![\p{L}\p{N}:#+.,/–-])(\d{1,2})(?:[.:](\d{2}))?(?= ?\(?(?:cest|cet)${NOT_BEFORE_WORD})`,
  "gu",
);
/** Ce qu'une fourchette sans unité compte quand ce n'est pas un horaire : « 18-25 ans », « 20-22 novembre ». */
const NOT_A_TIME_AFTER = new RegExp(
  String.raw`^ ?(?:%|€|(?:ans|yo|years?|joueu(?:r|se)s?|players?|personnes?|min|minutes?|k|sr|elo|jours?|days?|soirs?|fois|janv(?:ier)?|fev(?:r(?:ier)?)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|aout|sept(?:embre)?|oct(?:obre|ober)?|nov(?:embre|ember)?|dec(?:embre|ember)?|january|february|march|april|may|june|july|august|september|jan|feb|mar|apr|jun|jul|aug|sep)${NOT_BEFORE_WORD})`,
  "u",
);
const EVENING_FROM_HOUR = 13;
/** Dernière heure d'une fourchette qui passe minuit : « 22-1 CET ». */
const NIGHT_END_HOUR = 4;
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
 * Une fourchette devant « par jour » est une durée si sa première borne n'a pas
 * d'unité (« 2-3h ») ou si ses deux bornes sont de petits nombres d'heures
 * (« 1h-2h ») ; « 20h-23h par soir » reste une plage horaire.
 */
function isDurationRange(lower: string, end: number, first: TimeParts, second: TimeParts): boolean {
  if (!isDuration(lower, end)) return false;
  if (!first.explicit) return true;
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

function minutesOf(hour: string, minutes: string | undefined): number | null {
  const value = Number(hour) * 60 + Number(minutes ?? 0);
  return Number(minutes ?? 0) >= 60 || value > 24 * 60 ? null : value;
}

/** Fourchette sans unité : avec un fuseau derrière, ou en soirée et écrite au tiret. */
function unitlessRange(match: RegExpMatchArray, after: string): GetiTimeRange | null {
  const from = minutesOf(match[1], match[2]);
  const to = minutesOf(match[4], match[5]);
  if (from === null || to === null || from === to || NOT_A_TIME_AFTER.test(after)) return null;
  if (ZONE_AFTER_PATTERN.test(after)) return to > from || to <= NIGHT_END_HOUR * 60 ? { from, to } : null;
  if (to <= from) return null;
  if (match[3] === "/") {
    return from >= SLASH_FROM_HOUR * 60 && to - from <= SLASH_SPAN_MAX_HOURS * 60 ? { from, to } : null;
  }
  return from >= EVENING_FROM_HOUR * 60 ? { from, to } : null;
}

/** Horaires sans unité (« 20-22 CET », « 20 CET »), effacés du texte une fois lus. */
function parseUnitlessTimes(lower: string): { times: GetiTimeRange[]; rest: string } {
  const times: GetiTimeRange[] = [];
  let rest = lower;
  const erase = (index: number, length: number) => {
    rest = rest.slice(0, index) + " ".repeat(length) + rest.slice(index + length);
  };
  for (const match of lower.matchAll(UNITLESS_RANGE)) {
    const end = match.index + match[0].length;
    const range = unitlessRange(match, lower.slice(end, end + 12));
    if (range === null) continue;
    times.push(range);
    erase(match.index, match[0].length);
  }
  for (const match of rest.matchAll(UNITLESS_SINGLE)) {
    const from = minutesOf(match[1], match[2]);
    if (from === null) continue;
    times.push({ from, to: null });
    erase(match.index, match[0].length);
  }
  return { times, rest };
}

function parseTimes(lower: string): GetiTimeRange[] {
  const explicit = parseTimeRanges(lower);
  const unitless = parseUnitlessTimes(explicit.rest);
  const times = [...explicit.times, ...unitless.times];
  const rest = unitless.rest;
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
const TIMEZONE_CODE = /(?<![\p{L}\p{N}])(CEST|CET|BST|EET|(?:UTC|GMT)(?:\s?[+-]\s?\d{1,2})?)(?![\p{L}\p{N}])/u;
/** … ou en minuscules derrière une heure : « 20-22 cet », « 21h cest » (« cet été » n'en est pas un). */
const TIMEZONE_AFTER_TIME = /\d ?h? ?\(?(cest|cet)(?![\p{L}\p{N}])/u;
const PARIS_TIME = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:heure francaise|heure de paris|heure de france|french time|paris time)${NOT_BEFORE_WORD}`,
  "u",
);

function parseTimezone(prepared: GetiPreparedText): string | null {
  if (PARIS_TIME.test(prepared.lower)) return "Europe/Paris";
  const code = TIMEZONE_CODE.exec(prepared.plain);
  if (code !== null) return code[1].replace(/\s/gu, "");
  const afterTime = TIMEZONE_AFTER_TIME.exec(prepared.lower);
  return afterTime === null ? null : afterTime[1].toUpperCase();
}

const DAY_MS = 86_400_000;
/** Une date lue reste proche de la publication : au-delà, c'est autre chose (« 9/10 », une note). */
const DATE_WINDOW_DAYS = 60;
const DATE_MAX = 14;
const PARIS_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Jour civil à Paris d'un instant, en millisecondes UTC à minuit de ce jour. */
function parisDay(instant: number): number {
  const parts = PARIS_DATE.formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

function isoDay(day: number): string {
  return new Date(day).toISOString().slice(0, 10);
}

/** Jour de la semaine d'une date « AAAA-MM-JJ ». */
function weekdayOf(date: string): GetiDay {
  return GETI_DAYS[(new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7];
}

/** Jour civil valide (le 31/02 n'existe pas), en millisecondes UTC, ou `null`. */
function civilDay(year: number, month: number, day: number): number | null {
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? time : null;
}

/** « 26/11 », « 22/11/26 », « 02/12/2026 » — pas « 4/5 jours », « 3/4 soirs ». */
const NUMERIC_DATE = new RegExp(
  String.raw`(?<![\p{L}\p{N}/.,:–-])(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?(?![\p{N}/]|\s?(?:jours?|j|soirs?|fois|days?|nights?|semaines?|h)${NOT_BEFORE_WORD})`,
  "gu",
);
/** Début d'un nom de mois, collé au quantième : « Friday 27NOV ». */
const MONTH_START = "(?:jan|fev|feb|mar|avr|apr|mai|may|jui|jun|jul|aou|aug|sep|oct|nov|dec)";
/** Jour nommé suivi de son quantième : « Thursday 26 », « dimanche 29 ». */
const NAMED_DAY_NUMBER = new RegExp(
  String.raw`${NOT_AFTER_WORD}(${DAY_TABLE.pattern})\s(\d{1,2})(?!\p{N}|(?!${MONTH_START})\p{L}|\s?[/h:.k]|\s?[–-]\s?\d)`,
  "gu",
);
const TODAY = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:ce soir|tonight|today|aujourd'?\s?hui)${NOT_BEFORE_WORD}`,
  "u",
);
const TOMORROW = new RegExp(String.raw`${NOT_AFTER_WORD}(?:demain|tomorrow|tmrw|tmr)${NOT_BEFORE_WORD}`, "u");

/** Au-delà, les jours cités sont une disponibilité habituelle, pas des soirées précises. */
const EVENING_DAYS_MAX = 6;
/** « now », « asap » : pour tout de suite. */
const RIGHT_NOW = new RegExp(String.raw`${NOT_AFTER_WORD}(?:now|asap|maintenant|mtn)${NOT_BEFORE_WORD}`, "u");

/**
 * Soirées d'une recherche de scrim ou de remplaçant qui ne donne pas de date :
 * un jour nommé (« Mardi 21h-23h ») vise sa prochaine occurrence, et un
 * horaire sans jour (« LFS 3k5 20-22 CET ») ou un « now » le jour même de la
 * publication.
 */
function eveningDays(lower: string, today: number, found: readonly number[]): number[] {
  const dated = new Set(found.map((day) => weekdayOf(isoDay(day))));
  const named = parseDays(lower).filter((day) => !dated.has(day));
  if (named.length > EVENING_DAYS_MAX) return [];
  if (named.length === 0) {
    return found.length === 0 && (parseTimes(lower).length > 0 || RIGHT_NOW.test(lower)) ? [today] : [];
  }
  const todayIndex = GETI_DAYS.indexOf(weekdayOf(isoDay(today)));
  return named.map((day) => today + ((GETI_DAYS.indexOf(day) - todayIndex + 7) % 7) * DAY_MS);
}

/**
 * Dates visées par l'annonce (« 26/11 », « Thursday 26 », « ce soir »,
 * « tomorrow »), résolues depuis la date de publication, à l'heure de Paris.
 * Sans date de publication, rien n'est lu : une date sans année ne se situe pas.
 *
 * @param lower Texte sans accents, en minuscules.
 * @param postedAt Date ISO de publication, ou `null`.
 * @param sameDay `true` pour une recherche de scrim ou de remplaçant : un jour
 *   nommé vise sa prochaine occurrence, un horaire sans jour le soir même.
 * @returns Les dates « AAAA-MM-JJ », triées, sans doublon.
 */
export function parseGetiDates(lower: string, postedAt: string | null, sameDay = false): string[] {
  const posted = postedAt === null ? Number.NaN : Date.parse(postedAt);
  if (Number.isNaN(posted)) return [];
  const today = parisDay(posted);
  const year = new Date(today).getUTCFullYear();
  const near = (day: number | null) =>
    day !== null && day >= today - DAY_MS && day <= today + DATE_WINDOW_DAYS * DAY_MS ? day : null;
  const found: number[] = [];
  for (const match of lower.matchAll(NUMERIC_DATE)) {
    const [day, month] = [Number(match[1]), Number(match[2])];
    const written = match[3] === undefined ? null : Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    const date =
      written === null
        ? (near(civilDay(year, month, day)) ?? near(civilDay(year + 1, month, day)))
        : near(civilDay(written, month, day));
    if (date !== null) found.push(date);
  }
  for (const match of lower.matchAll(NAMED_DAY_NUMBER)) {
    const named = DAY_TABLE.lookup.get(aliasKey(match[1]));
    const month = new Date(today).getUTCMonth() + 1;
    const next = month === 12 ? civilDay(year + 1, 1, Number(match[2])) : civilDay(year, month + 1, Number(match[2]));
    // Ce mois-ci, sinon le suivant ; le quantième doit tomber sur le jour nommé.
    const date = [civilDay(year, month, Number(match[2])), next]
      .map(near)
      .find((day) => day !== null && weekdayOf(isoDay(day)) === named);
    if (date !== undefined && date !== null) found.push(date);
  }
  if (TODAY.test(lower)) found.push(today);
  if (TOMORROW.test(lower)) found.push(today + DAY_MS);
  if (sameDay) found.push(...eveningDays(lower, today, found));
  return [...new Set(found)]
    .sort((a, b) => a - b)
    .slice(0, DATE_MAX)
    .map(isoDay);
}

/**
 * Disponibilités : jours cités, horaires (minutes depuis minuit) et fuseau.
 *
 * @param prepared Formes d'analyse du texte.
 * @param dates Dates déjà lues (`parseGetiDates`) : leur jour de semaine s'ajoute aux jours cités.
 * @returns Les disponibilités, listes vides quand rien n'est lu.
 */
export function parseGetiAvailability(prepared: GetiPreparedText, dates: readonly string[] = []): GetiAvailability {
  return {
    days: inReferenceOrder(GETI_DAYS, [...parseDays(prepared.lower), ...dates.map(weekdayOf)]),
    times: parseTimes(prepared.lower),
    timezone: parseTimezone(prepared),
  };
}

const LEVEL_ALIASES: Readonly<Record<GetiLevel, readonly string[]>> = {
  OPEN: ["open"],
  INTERMEDIATE: ["intermediate", "intermediaire", "intermediaires", "inter", "int"],
  ADVANCED: ["advanced", "adv"],
  EXPERT: ["expert", "exp"],
};
const LEVEL_TABLE = aliasTable(LEVEL_ALIASES);
/** Un niveau, avec sa nuance collée ou non devant : « high open », « HighOpen », « low-mid advanced ». */
const LEVEL_WORD = new RegExp(
  String.raw`${NOT_AFTER_WORD}((?:high|low|mid|haut|bas)[\s-]?)?(${LEVEL_TABLE.pattern})${NOT_BEFORE_WORD}`,
  "gu",
);
/**
 * Abréviations qui sont d'abord autre chose (« exp : 200 h de scrim », un
 * entier) : lues seulement nuancées (« low int ») ou collées à un autre niveau
 * (« adv/exp », « open-adv-inter »).
 */
const LEVEL_NEEDS_CONTEXT = new Set(["int", "exp"]);
const LEVEL_JOIN = /^\s?(?:[/,&>→–-]|-+>|to|a)\s?(?:(?:high|low|mid|haut|bas)[\s-]?)?$/u;
/** « open » au sens courant : « DMs open », « position open for trials », « open to all ». */
const OPEN_COMMON_BEFORE = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:dms?|mps?|pms?|positions?|postes?|spots?|slots?|tryouts?|trials?|is|are|est|sont|still|now)\s$`,
  "u",
);
const OPEN_COMMON_AFTER = new RegExp(String.raw`^\s(?:for|to|a|aux|pour|until|jusqu)${NOT_BEFORE_WORD}`, "u");

type LevelMatch = { start: number; end: number; key: string; level: GetiLevel; nuanced: boolean };

/**
 * Niveaux de division cités (ligue FACEIT : Open, Intermediate, Advanced,
 * Expert) — le niveau d'une équipe qui cherche un scrim ou un joueur, ou celui
 * qu'un joueur vise.
 *
 * @param lower Texte sans accents, en minuscules.
 * @returns Les niveaux, dans l'ordre de `GETI_LEVELS`.
 */
export function parseGetiLevels(lower: string): GetiLevel[] {
  const matches: LevelMatch[] = [];
  for (const match of lower.matchAll(LEVEL_WORD)) {
    const key = aliasKey(match[2]);
    const level = LEVEL_TABLE.lookup.get(key);
    if (level === undefined) continue;
    const end = match.index + match[0].length;
    matches.push({ start: match.index, end, key, level, nuanced: match[1] !== undefined });
  }
  const joined = (index: number) =>
    [index - 1, index].some((left) => {
      const [first, second] = [matches[left], matches[left + 1]];
      return first !== undefined && second !== undefined && LEVEL_JOIN.test(lower.slice(first.end, second.start));
    });
  const found = matches.filter((match, index) => {
    if (match.nuanced || joined(index)) return true;
    if (LEVEL_NEEDS_CONTEXT.has(match.key)) return false;
    if (match.key !== "open") return true;
    return (
      !OPEN_COMMON_BEFORE.test(lower.slice(Math.max(0, match.start - 12), match.start)) &&
      !OPEN_COMMON_AFTER.test(lower.slice(match.end, match.end + 8))
    );
  });
  return inReferenceOrder(
    GETI_LEVELS,
    found.map((match) => match.level),
  );
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
 * « 18+ » ou « +18 » est un âge, sauf devant ce qu'il compte : « +20 joueurs »,
 * « 15+ heures », « 20+ scrims » sont des nombres ; « 18+ dps », « +18 FR » des âges.
 */
const AGE_COUNTED_AFTER = new RegExp(
  String.raw`^[^\S\n]*(?:de[^\S\n]+)?(?:joueu(?:r|se)s?|players?|membres?|members?|personnes?|people|gens|h|hrs?|heures?|hours?|jours?|days?|mois|months?|semaines?|weeks?|scrims?|games?|parties|matchs?|matches|wins?|victoires?|tournois?|tournaments?|viewers?|vues|views|abonnes?|followers?|subs?|equipes|teams|rosters|places?|slots?|sr|elo|k|€|\$|euros?|%|ms|fps|hz)${NOT_BEFORE_WORD}`,
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
      const end = match.index + match[0].length;
      if (!unlabelled || !AGE_COUNTED_AFTER.test(lower.slice(end, end + 20))) return Number(match[1]);
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
/** Nom suivi de ce qui en fait une structure : « Chroma Esport », « ELEVEN Academy », « Clay Family ». */
const TEAM_SUFFIXED = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${NAME_TOKEN}(?: +${NAME_TOKEN}){0,2}) +(E-?[Ss]ports?|E-?SPORTS?|Gaming|GAMING|Academy|ACADEMY|Family|FAMILY)(?![\p{L}\p{N}])`,
  "gu",
);
/** Nom en capitale juste devant le verbe de l'annonce : « MTP RECRUTE », « Verdict Astral recherche ». */
const TEAM_BEFORE_VERB = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${NAME_TOKEN}(?: +${NAME_TOKEN}){0,2}) +(?:[Rr]ecrute|RECRUTE|[Rr]echerche|RECHERCHE|[Cc]herche|CHERCHE|is looking|are looking|is recruiting|IS LOOKING|ARE LOOKING|IS RECRUITING)(?![\p{L}\p{N}])`,
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
    "je j nous on il elle ils elles vous tu notre nos votre vos mon ma mes",
    "equipe lequipe team structure lastructure roster association lassociation asso lasso staff",
    "recrutement recrute recrutements bonjour hello salut chez join rejoins rejoindre avec with by",
    "coach manager analyste analyst joueur joueuse joueurs joueuses player players hitscan hs fdps main sub",
    "open inter intermediate advanced adv expert low mid high only mixed hybrid elo sr faceit cet cest utc gmt",
  ]
    .join(" ")
    .split(" "),
);
/** Mots qui, seuls, ne nomment personne : « la structure E-sport », « notre pôle Overwatch ». */
const NOT_A_NAME_ALONE = new Set(["esport", "esports", "gaming", "academy", "family", "league", "ligue"]);
/** Un SR n'est pas un nom : « Roster 3K », « ROSTER 4K3 ». */
const SR_WORD = /^(?:[1-5]k\d?)+$/u;
/**
 * Pronoms anglais : un nom en capitales peut en finir un (« Team Game I »,
 * « Team Ride Or Die » n'en a pas, « Team Not You »), pas en ouvrir un
 * (« team We are looking »). « on » reste français (« team Phoenix On cherche »).
 */
const ENGLISH_PRONOUNS = new Set(["we", "i", "you", "they", "he", "she", "my", "our", "your"]);

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

function isNameWord(word: string, index: number): boolean {
  const key = nameKey(word);
  if (key === "" || NOT_A_NAME.has(key) || /^[bsgpdmc][1-5]$/u.test(key) || SR_WORD.test(key)) return false;
  return !ENGLISH_PRONOUNS.has(key) || (index > 0 && CAPITALISED.test(word));
}

function cleanTeamName(candidate: string, skipLeading = false): string | null {
  const all = candidate.split(/\s+/u).filter((word) => word !== "");
  // Devant un verbe ou un suffixe, les premiers mots sont souvent du vocabulaire, un article ou un
  // horaire : « L'association Blue Sonate recrute », « La LND ASTRA cherche », « 20-23 CET Chroma Esport ».
  const leads = (word: string) => !isNameWord(word, 0) || !/\p{L}/u.test(word) || LEADING_ARTICLES.has(nameKey(word));
  const first = skipLeading ? all.findIndex((word) => !leads(word)) : 0;
  const words = first === -1 ? [] : all.slice(first);
  // Le nom s'arrête au premier mot du vocabulaire d'annonce : « Blue Phoenix EU ».
  const stop = words.findIndex((word, index) => !isNameWord(word, index));
  const kept = stop === -1 ? words : words.slice(0, stop);
  if (kept.length === 1 && NOT_A_NAME_ALONE.has(nameKey(kept[0]))) return null;
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
    const name = cleanTeamName(match[1]);
    if (name !== null) return name;
  }
  for (const match of clean.matchAll(TEAM_SUFFIXED)) {
    const name = cleanTeamName(`${match[1]} ${match[2]}`, true);
    // Le suffixe seul ne nomme rien : il faut au moins un mot devant lui.
    if (name !== null && name.includes(" ")) return name;
  }
  for (const match of clean.matchAll(TEAM_BEFORE_VERB)) {
    const name = cleanTeamName(match[1], true);
    if (name !== null && name === match[1].trim().split(/\s+/u).slice(-name.split(" ").length).join(" ")) return name;
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
