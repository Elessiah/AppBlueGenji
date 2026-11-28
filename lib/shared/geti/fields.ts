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
  withoutMarkup,
  type GetiPreparedText,
} from "@/lib/shared/geti/normalize";
import { getiSlotEndMinutes } from "@/lib/shared/geti/filter";
import {
  CET_DEMONSTRATIVE,
  GETI_DAY_MS,
  GETI_PARIS_ZONE,
  getiCivilDay,
  getiParisShiftMinutes,
  getiWallInstant,
  getiWrapMinutes,
  getiZoneRule,
  parseGetiTimezone,
  type GetiZoneRule,
} from "@/lib/shared/geti/zones";
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
/** Les trois derniers mots, sans franchir un chiffre ni une ligne (sans regex à retour arrière). */
function lastWords(before: string): (string | undefined)[] {
  const tail = before.split(/[\n\p{N}]/u).at(-1) ?? "";
  const words = tail.match(/\p{L}+/gu) ?? [];
  return [words.at(-3), words.at(-2), words.at(-1)];
}

function isParticiple(before: string): boolean {
  const [third, subject, previous] = lastWords(before);
  if (previous === undefined) return false;
  if (previous === "a") return subject !== undefined && A_SUBJECTS.has(subject);
  if (AMBIGUOUS_ADVERBS.has(previous)) {
    // « on a bien eu » : « a » derrière son sujet ; « de NA à tout EU » : la région.
    if (subject === "a") return third !== undefined && A_SUBJECTS.has(third);
    return subject !== undefined && AVOIR.has(subject);
  }
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
const BOTH_PLATFORMS_ALL = new RegExp(BOTH_PLATFORMS.source, "gu");
/**
 * « Hybrid » est aussi un mode de carte : cité près d'un autre mode ou du mot
 * « map » (« maps: control, hybrid, push »), il ne dit pas la plateforme.
 */
const MAP_MODE_WORDS = "maps? cartes? modes? control controle push escort escorte flashpoint clash assault assaut koth";
const MAP_MODE_NEAR = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:${MAP_MODE_WORDS.split(" ").join("|")})${NOT_BEFORE_WORD}`,
  "u",
);
const MAP_MODE_REACH = 30;

/** Une mention « hybrid » ou « crossplay » qui dit la plateforme, pas le mode de carte. */
function saysBothPlatforms(lower: string): boolean {
  for (const match of lower.matchAll(BOTH_PLATFORMS_ALL)) {
    const end = match.index + match[0].length;
    const around = lower.slice(Math.max(0, match.index - MAP_MODE_REACH), end + MAP_MODE_REACH);
    if (!match[0].includes("hybrid") || !MAP_MODE_NEAR.test(around)) return true;
  }
  return false;
}

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
  if (saysBothPlatforms(lower) || (scrim && MIXED.test(lower))) return [...GETI_PLATFORMS];
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
    found.push(...listedDays(list[0], days));
  }
  return found;
}

/** Jours d'une liste d'abréviations (`list`, ses jours `days`). */
function listedDays(list: string, days: readonly GetiDay[]): GetiDay[] {
  // « lun-ven », « mon-fri » : la fourchette entière.
  if (days.length === 2 && /^\p{L}+\.?\s?[–-]/u.test(list)) {
    const range: GetiDay[] = [];
    for (let index = GETI_DAYS.indexOf(days[0]); ; index = (index + 1) % GETI_DAYS.length) {
      range.push(GETI_DAYS[index]);
      if (GETI_DAYS[index] === days[1]) return range;
    }
  }
  // Deux abréviations différentes au moins : « sun sun » ou « mer mer » ne sont pas des jours. Deux mots
  // séparés d'une virgule seule sont une phrase (« ce jeu, mon rang ») : « lun/mer », « lun, mer, ven » restent lus.
  const commaPair = days.length === 2 && /^[^/&–-]*$/u.test(list);
  return new Set(days).size > 1 && !commaPair ? [...days] : [];
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
  String.raw`(?<![\p{L}\p{N}:#+.,/–-])(\d{1,2})(?:[.:](\d{2}))?(?= ?\(?(?:cest|cet)${NOT_BEFORE_WORD}(?!${CET_DEMONSTRATIVE}))`,
  "gu",
);
/** Une tranche d'âge devant la fourchette : « âge : 16-20 », « âgés de 18-25 », « tranche 16-22 ». */
const AGE_BEFORE_RANGE = new RegExp(
  String.raw`(?<!\p{L})(?:ages?|agees?|tranche(?: d'?\s?age)?|age range)\s?(?:[:=]|de|entre|between)?\s?$`,
  "u",
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
    if (AGE_BEFORE_RANGE.test(lower.slice(Math.max(0, match.index - 20), match.index))) continue;
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

const DAY_MS = GETI_DAY_MS;
/** Une date lue reste proche de la publication : au-delà, c'est autre chose (« 9/10 », une note). */
const DATE_WINDOW_DAYS = 60;
const DATE_MAX = 14;

function isoDay(day: number): string {
  return new Date(day).toISOString().slice(0, 10);
}

/** Jour de la semaine d'un jour civil (millisecondes UTC à minuit). */
function weekdayOf(day: number): GetiDay {
  return GETI_DAYS[(new Date(day).getUTCDay() + 6) % 7];
}

/** Jour civil valide (le 31/02 n'existe pas), en millisecondes UTC, ou `null`. */
function civilDay(year: number, month: number, day: number): number | null {
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? time : null;
}

/** « 26/11 », « 22/11/26 », « 02/12/2026 » — pas « 4/5 jours », « 3/4 soirs », « 2/3 joueurs », « 1/12 places », « 1/2 tanks ». */
const NUMERIC_DATE = new RegExp(
  String.raw`(?<![\p{L}\p{N}/.,:–-])(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?(?![\p{N}/]|\s?(?:jours?|j|soirs?|fois|days?|nights?|semaines?|h|joueu(?:r|se)s?|players?|places?|slots?|spots?|personnes?|membres?|members?|postes?|tanks?|dps|supp(?:ort)?s?|heal(?:er)?s?|flex|mains?|subs?|remplacants?|roles?)${NOT_BEFORE_WORD})`,
  "gu",
);
/** Début d'un nom de mois, collé au quantième : « Friday 27NOV ». */
const MONTH_START = "(?:jan|fev|feb|mar|avr|apr|mai|may|jui|jun|jul|aou|aug|sep|oct|nov|dec)";
/** Jour nommé suivi de son quantième : « Thursday 26 », « dimanche 29 ». */
const NAMED_DAY_NUMBER = new RegExp(
  String.raw`${NOT_AFTER_WORD}(${DAY_TABLE.pattern})\s(\d{1,2})(?!\p{N}|(?!${MONTH_START})\p{L}|\s?[/h:.k]|\s?[–-]\s?\d)`,
  "gu",
);
/** Le jour même de la publication : « ce soir », « tonight », « cet après-midi ». */
const TODAY = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:ce soir|cette nuit|ce midi|ce matin|cet(?:te)? apres[\s-]?midi|cet(?:te)? aprem|cet apm|tonight|tonite|this evening|this afternoon|this morning)${NOT_BEFORE_WORD}`,
  "u",
);
/**
 * « aujourd'hui », « today », « ajd » : une date dans une recherche de scrim ou
 * de remplaçant seulement — ailleurs c'est souvent une tournure (« aujourd'hui,
 * on recrute »), qui daterait à tort un recrutement.
 */
const TODAY_WORD = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:today|aujourd'?\s?hui|aujd|auj|ajd)${NOT_BEFORE_WORD}`,
  "u",
);
/** Le surlendemain ; lu avant « demain », qu'il contient. */
const DAY_AFTER_TOMORROW = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:apres[\s-]?demain|the day after tomorrow|day after tomorrow)${NOT_BEFORE_WORD}`,
  "gu",
);
const TOMORROW = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:demain|tomorrow|tomorow|tommorow|tommorrow|tmrw|tmr)${NOT_BEFORE_WORD}`,
  "u",
);
/** « ce week-end », « this weekend », « ce we » : le samedi et le dimanche qui viennent (« le week-end » reste une habitude). */
const THIS_WEEKEND = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:(?:ce|this|du)\sweek[\s-]?end|ce\s(?:we|wk))${NOT_BEFORE_WORD}`,
  "u",
);
/** « lundi prochain », « next friday » : la prochaine occurrence après le jour de la publication. */
const NEXT_NAMED_DAY = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:(${DAY_TABLE.pattern})\s(?:prochaine?|pro)|next\s(${DAY_TABLE.pattern}))${NOT_BEFORE_WORD}`,
  "gu",
);
/** « ce vendredi », « this friday » : la prochaine occurrence, jour de la publication compris. */
const THIS_NAMED_DAY = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:ce|this)\s(${DAY_TABLE.pattern})${NOT_BEFORE_WORD}`,
  "gu",
);

/** Jour gardé s'il reste proche de la publication (`today`), `null` sinon. */
function nearDay(day: number | null, today: number): number | null {
  return day !== null && day >= today - DAY_MS && day <= today + DATE_WINDOW_DAYS * DAY_MS ? day : null;
}

/** Année écrite d'une date : « 26 » vaut 2026. */
function writtenYear(year: string): number {
  return Number(year.length === 2 ? `20${year}` : year);
}

/**
 * Dates « jour/mois » : dans l'année de la publication, la suivante ou la
 * précédente (« 31/12 » lu un 1er janvier), ou dans l'année écrite.
 */
function numericDates(lower: string, today: number): number[] {
  const year = new Date(today).getUTCFullYear();
  const found: number[] = [];
  for (const match of lower.matchAll(NUMERIC_DATE)) {
    const [day, month] = [Number(match[1]), Number(match[2])];
    const years = match[3] === undefined ? [year, year + 1, year - 1] : [writtenYear(match[3])];
    const date = years.map((candidate) => nearDay(civilDay(candidate, month, day), today)).find((near) => near !== null);
    if (date !== undefined && date !== null) found.push(date);
  }
  return found;
}

/** Jour nommé et quantième : ce mois-ci, sinon le suivant ; le quantième doit tomber sur le jour nommé. */
function namedDayDates(lower: string, today: number): number[] {
  const year = new Date(today).getUTCFullYear();
  const month = new Date(today).getUTCMonth() + 1;
  const found: number[] = [];
  for (const match of lower.matchAll(NAMED_DAY_NUMBER)) {
    const named = DAY_TABLE.lookup.get(aliasKey(match[1]));
    const day = Number(match[2]);
    const next = month === 12 ? civilDay(year + 1, 1, day) : civilDay(year, month + 1, day);
    const date = [civilDay(year, month, day), next]
      .map((candidate) => nearDay(candidate, today))
      .find((near) => near !== null && weekdayOf(near) === named);
    if (date !== undefined && date !== null) found.push(date);
  }
  return found;
}

/** Jours d'ici la prochaine occurrence d'un jour nommé (0 : le jour même). */
function daysUntil(day: GetiDay, today: number): number {
  return (GETI_DAYS.indexOf(day) - GETI_DAYS.indexOf(weekdayOf(today)) + 7) % 7;
}

/**
 * Jours dits par rapport à la publication : « ce soir », « demain »,
 * « après-demain », « ce week-end », « lundi prochain », « this friday » ;
 * « aujourd'hui » pour une recherche de scrim ou de remplaçant (`sameDay`).
 */
function relativeDays(lower: string, today: number, sameDay: boolean): number[] {
  const found: number[] = [];
  if (TODAY.test(lower) || (sameDay && TODAY_WORD.test(lower))) found.push(today);
  const withoutDayAfter = lower.replace(DAY_AFTER_TOMORROW, (matched) => {
    found.push(today + 2 * DAY_MS);
    return " ".repeat(matched.length);
  });
  if (TOMORROW.test(withoutDayAfter)) found.push(today + DAY_MS);
  if (THIS_WEEKEND.test(lower)) {
    // Publiée un dimanche : il ne reste que ce dimanche-là.
    const saturday = today + daysUntil("SAT", today) * DAY_MS;
    found.push(...(weekdayOf(today) === "SUN" ? [today] : [saturday, saturday + DAY_MS]));
  }
  const dayOf = (text: string | undefined) => (text === undefined ? undefined : DAY_TABLE.lookup.get(aliasKey(text)));
  for (const match of lower.matchAll(NEXT_NAMED_DAY)) {
    const day = dayOf(match[1] ?? match[2]);
    if (day !== undefined) found.push(today + (daysUntil(day, today) || 7) * DAY_MS);
  }
  for (const match of lower.matchAll(THIS_NAMED_DAY)) {
    const day = dayOf(match[1]);
    if (day !== undefined) found.push(today + daysUntil(day, today) * DAY_MS);
  }
  return found;
}

/** Au-delà, les jours cités sont une disponibilité habituelle, pas des soirées précises. */
const EVENING_DAYS_MAX = 6;
/** « now », « asap » : pour tout de suite. */
const RIGHT_NOW = new RegExp(String.raw`${NOT_AFTER_WORD}(?:now|asap|maintenant|mtn)${NOT_BEFORE_WORD}`, "u");

/**
 * Soirées d'une recherche de scrim ou de remplaçant qui ne donne pas de date :
 * un jour nommé (« Mardi 21h-23h ») vise sa prochaine occurrence, et un
 * horaire sans jour (« LFS 3k5 20-22 CET ») ou un « now » le jour même de la
 * publication (`implicit` : ce jour-là n'est écrit nulle part, seul l'horaire le donne).
 */
function eveningDays(
  lower: string,
  today: number,
  found: readonly number[],
  named: readonly GetiDay[],
  timed: boolean,
): { days: number[]; implicit: boolean } {
  const dated = new Set(found.map(weekdayOf));
  const undated = named.filter((day) => !dated.has(day));
  if (undated.length > EVENING_DAYS_MAX) return { days: [], implicit: false };
  if (undated.length === 0) {
    if (found.length > 0) return { days: [], implicit: false };
    if (RIGHT_NOW.test(lower)) return { days: [today], implicit: false };
    return timed ? { days: [today], implicit: true } : { days: [], implicit: false };
  }
  return { days: undated.map((day) => today + daysUntil(day, today) * DAY_MS), implicit: false };
}

const PARIS_RULE: GetiZoneRule = { iana: GETI_PARIS_ZONE };

/** Horaires écrits ramenés à l'heure de Paris (`shift` minutes à ajouter). */
function shiftedTimes(times: readonly GetiTimeRange[], shift: number): GetiTimeRange[] {
  return times.map((time) => ({
    from: getiWrapMinutes(time.from + shift),
    to: time.to === null ? null : getiWrapMinutes(time.to + shift, true),
  }));
}

/** Dates et disponibilités d'une annonce, à l'heure de Paris. */
export type GetiSchedule = { dates: string[]; availability: GetiAvailability };

/**
 * Dates visées (« 26/11 », « Thursday 26 », « ce soir », « demain »,
 * « après-demain », « ce week-end », « lundi prochain ») et disponibilités
 * (jours, horaires, fuseau) d'une annonce.
 *
 * - Tout mot relatif se résout depuis la **date de publication**, jamais depuis
 *   l'heure de lecture, dans le fuseau écrit par l'annonce (Paris sinon). Sans
 *   date de publication, aucune date n'est lue ni aucun horaire converti.
 * - Un fuseau écrit (« 21h UTC », « 9pm EST ») convertit horaires et dates à
 *   l'heure de Paris, heure d'été comprise ; les horaires tels qu'écrits restent
 *   dans `statedTimes`. Une date suit son premier horaire (« Friday 9pm EST »
 *   tombe le samedi à Paris).
 * - `sameDay` (recherche de scrim ou de remplaçant) : un jour nommé vise sa
 *   prochaine occurrence, un horaire sans jour le soir même — le lendemain si
 *   ce créneau était déjà fini à la publication. Les jours rendus sont alors
 *   ceux des dates.
 *
 * @param prepared Formes d'analyse du texte.
 * @param postedAt Date ISO de publication, ou `null`.
 * @param sameDay `true` pour une recherche de scrim ou de remplaçant.
 * @returns Les dates « AAAA-MM-JJ » (Paris), triées, sans doublon, et les disponibilités.
 */
export function parseGetiSchedule(prepared: GetiPreparedText, postedAt: string | null, sameDay = false): GetiSchedule {
  const lower = prepared.lower;
  const timezone = parseGetiTimezone(prepared);
  const stated = parseTimes(lower);
  const named = parseDays(lower);
  const posted = postedAt === null ? Number.NaN : Date.parse(postedAt);
  if (Number.isNaN(posted)) return { dates: [], availability: { days: named, times: stated, timezone } };
  const rule = getiZoneRule(timezone) ?? PARIS_RULE;
  const today = getiCivilDay(posted, rule);
  const found = [...numericDates(lower, today), ...namedDayDates(lower, today), ...relativeDays(lower, today, sameDay)];
  const evening = sameDay ? eveningDays(lower, today, found, named, stated.length > 0) : { days: [], implicit: false };
  // Un créneau sans jour, déjà fini quand l'annonce est publiée (« 21-23 » écrit à 23 h 30), vise le lendemain.
  const over = evening.implicit && posted >= getiWallInstant(today, getiSlotEndMinutes(stated), rule);
  const days = [...new Set([...found, ...(over ? [today + DAY_MS] : evening.days)])].sort((a, b) => a - b).slice(0, DATE_MAX);
  const first = stated[0]?.from;
  const shift = first === undefined ? 0 : getiParisShiftMinutes(rule, days[0] ?? today, first);
  const dayShift = first === undefined ? 0 : Math.floor((first + shift) / 1440);
  const dates = days.map((day) => day + dayShift * DAY_MS);
  const shiftDay = (day: GetiDay) => GETI_DAYS[(GETI_DAYS.indexOf(day) + dayShift + 7) % 7];
  // Scrim ou remplaçant aux soirées datées : les jours sont ceux des dates, rien d'autre.
  const datedOnly = sameDay && dates.length > 0 && named.length <= EVENING_DAYS_MAX;
  return {
    dates: dates.map(isoDay),
    availability: {
      days: inReferenceOrder(GETI_DAYS, [...(datedOnly ? [] : named.map(shiftDay)), ...dates.map(weekdayOf)]),
      times: shift === 0 ? stated : shiftedTimes(stated, shift),
      timezone,
      ...(shift === 0 ? {} : { statedTimes: stated }),
    },
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
 * entier) : lues seulement nuancées (« low int », pas « low exp ») ou collées
 * à un autre niveau (« adv/exp », « open-adv-inter »).
 */
const LEVEL_NEEDS_CONTEXT = new Set(["int", "exp"]);
/** « exp » nuancé est d'abord l'expérience (« low exp accepté ») : lu seulement collé à un autre niveau. */
const LEVEL_NEEDS_JOIN = new Set(["exp"]);
const LEVEL_JOIN = /^\s?(?:[/,&>→–-]|-+>|to|a)\s?(?:(?:high|low|mid|haut|bas)[\s-]?)?$/u;
/** « open » au sens courant : « DMs open », « position open for trials », « open to all ». */
const OPEN_COMMON_BEFORE = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:dms?|mps?|pms?|positions?|postes?|spots?|slots?|tryouts?|trials?|recrutements?|recruitments?|recruiting|inscriptions?|candidatures?|applications?|apps|is|are|est|sont|still|now|toujours|always)\s$`,
  "u",
);
/** … et derrière : « open to all », « open for trials ». */
const OPEN_COMMON_AFTER = new RegExp(String.raw`^\s(?:for|to|a|aux|pour|until|jusqu)${NOT_BEFORE_WORD}`, "u");
/** « open minded », « open-mind », « open d'esprit » : un trait de caractère. */
const OPEN_MINDED = new RegExp(String.raw`^(?:[\s-]?minded|[\s-]?mind${NOT_BEFORE_WORD}|\sd'?\s?esprit)`, "u");

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
    // « open-minded » n'est jamais un niveau, même collé à un autre (« low int, open-minded »).
    if (match.key === "open" && OPEN_MINDED.test(lower.slice(match.end, match.end + 12))) return false;
    if (joined(index)) return true;
    if (LEVEL_NEEDS_JOIN.has(match.key)) return false;
    if (match.nuanced) return true;
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
 * Derrière « 18+ » ou « +18 » sans mot d'âge : la fin, une ponctuation, un mot
 * d'âge, ou un mot d'annonce (rôle, région, langue, plateforme : « 18+ dps »,
 * « +18 FR »). « +20 joueurs », « +15 min » ou « 20+ inscrits » sont des nombres.
 */
const AGE_FOLLOW = new RegExp(
  String.raw`^[^\S\n]*(?:$|[^\p{L}\p{N}\s]|\n|(?:ans?|yo|y/o|years?|old|only|seulement|uniquement|obligatoire|requis|required|minimum|mini|svp|pls|please|et|and|ou|or|de preference|preferable|preferably|preferred|prefere|idealement|ideally|conseille|recommande|recommended|souhaite|mature|matures|tank|tanks|dps|supp?|supports?|heal|heals|healers?|flex|fr|eu|na|eng?|euw|francais|francaise|francophones?|english|anglophones?|pc|console|ps5|xbox|team|equipe|lfp|lft|lfs|lfsub|lfstaff|lfcast)${NOT_BEFORE_WORD})`,
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
/**
 * Seuls les 80 premiers caractères derrière le libellé sont lus (coût borné) :
 * la ligne peut être plus longue — « Équipe : Blue Phoenix — nous cherchons… ».
 */
const TEAM_LABEL = new RegExp(String.raw`^[ \t]*(?:${TEAM_LABEL_WORDS})\s?[:=]\s?(.{1,80})`, "imu");
/** Mot d'un nom, borné : un long « A-A-A-… » ne fait pas relire tout le reste du texte depuis chaque tiret. */
const NAME_TOKEN = String.raw`[\p{Lu}\p{N}][\p{L}\p{N}'.-]{0,31}`;
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
/** Ce que cherche un joueur, derrière le verbe : « cherche une équipe », « is looking for a team » (pas « recrute une team »). */
const SEEKS_A_TEAM = /^\s+(?:[\p{L}']+\s+){0,2}?(?:[ée]quipe|team|structure|club|roster)s?(?![\p{L}\p{N}])/iu;
/** Fin d'un nom derrière un libellé : première ponctuation de séparation. */
const LABEL_END = /\s[-–—]\s|[,;•·(\[]|\s{2,}/u;

/**
 * Mots qui ne font pas un nom d'équipe : vocabulaire de l'annonce (rangs,
 * rôles, régions, sigles) et verbes qui suivent « team » dans une phrase.
 */
const NOT_A_NAME = new Set(
  [
    "fr eu na en pc ow ow2 overwatch lfp lft lfs lfsub lfstaff lfcast",
    "bronze silver gold plat platine platinum emeraude emerald diam diamant diamond master masters gm grandmaster champion top500",
    "tank dps support supp heal flex console ps5 xbox",
    "cherche recherche recrute looking seeking need needs is are est qui de du des en a au and et for pour",
    "competitive competitif compet chill serieuse serieux tryhard semi francaise francophone",
    "name nom discord role roles rang rank region plateforme platform contact",
    "je j nous il elle ils elles vous tu notre nos votre vos mon ma mes",
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

const NAME_MARKS = /\p{M}/gu;
const NAME_SYMBOLS = /[^\p{L}\p{N}]/gu;
const TIER_LIKE = /^[bsgpedmc][1-5]$/u;

function nameKey(word: string): string {
  return word.normalize("NFD").replace(NAME_MARKS, "").toLowerCase().replace(NAME_SYMBOLS, "");
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
  if (key === "" || NOT_A_NAME.has(key) || TIER_LIKE.test(key) || SR_WORD.test(key)) return false;
  const verbAfter = verbAfterPronoun(key);
  if (verbAfter === null) return true;
  return place.index > 0 && place.last && CAPITALISED.test(word) && !verbAfter.test(place.following);
}

/**
 * @param candidate Mots lus derrière « team » ou le libellé, ou devant un verbe ou un suffixe.
 * @param following Texte qui suit le candidat (vide derrière un libellé).
 * @param skipLeading `true` devant un verbe ou un suffixe : les premiers mots qui ne nomment rien sont passés.
 */
function cleanTeamName(candidate: string, following = "", skipLeading = false): string | null {
  const all = candidate.split(/\s+/u).filter((word) => word !== "");
  // Devant un verbe ou un suffixe, les premiers mots sont souvent du vocabulaire, un article ou un
  // horaire : « L'association Blue Sonate recrute », « La LND ASTRA cherche », « 20-23 CET Chroma Esport ».
  const leads = (word: string) =>
    !isNameWord(word, { index: 0, last: false, following: "" }) ||
    !/\p{L}/u.test(word) ||
    LEADING_ARTICLES.has(nameKey(word));
  const first = skipLeading ? all.findIndex((word) => !leads(word)) : 0;
  const words = first === -1 ? [] : all.slice(first);
  // Le nom s'arrête au premier mot du vocabulaire d'annonce : « Blue Phoenix EU ».
  const stop = words.findIndex(
    (word, index) => !isNameWord(word, { index, last: index === words.length - 1, following }),
  );
  const kept = stop === -1 ? words : words.slice(0, stop);
  if (kept.length === 1 && NOT_A_NAME_ALONE.has(nameKey(kept[0]))) return null;
  const name = withoutMarkup(visibleText(kept.join(" "))).replace(/[.'-]+$/u, "");
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
 * @param playerSearch `true` pour un joueur qui cherche une équipe (`lft`) : le mot devant le verbe n'est pas lu.
 * @param scrimSearch `true` pour une recherche de scrim (`lfs`) : « X cherche une équipe » y nomme l'équipe X.
 * @returns Le nom, ou `null` quand rien de net n'est lu.
 */
export function parseGetiTeamName(clean: string, playerSearch = false, scrimSearch = false): string | null {
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
  return structureName(clean, playerSearch, scrimSearch);
}

/**
 * À défaut de « team … » : le nom devant un suffixe de structure, sinon devant
 * le verbe de l'annonce — sauf pour un joueur qui cherche une équipe
 * (« Lucas recherche une team » : son pseudo, pas une équipe), où que
 * l'annonce soit postée (« Kevin cherche une équipe en tant que coach »).
 */
function structureName(clean: string, playerSearch: boolean, scrimSearch: boolean): string | null {
  for (const match of clean.matchAll(TEAM_SUFFIXED)) {
    const name = cleanTeamName(`${match[1]} ${match[2]}`, "", true);
    // Le suffixe seul ne nomme rien : il faut au moins un mot devant lui.
    if (name?.includes(" ") === true) return name;
  }
  if (playerSearch) return null;
  for (const match of clean.matchAll(TEAM_BEFORE_VERB)) {
    const end = match.index + match[0].length;
    // « X recrute une team » : une structure qui recrute un roster, elle, se nomme bien.
    const recruits = /recru/iu.test(match[0].slice(match[1].length));
    if (!scrimSearch && !recruits && SEEKS_A_TEAM.test(clean.slice(end, end + 32))) continue;
    const name = cleanTeamName(match[1], "", true);
    // Le nom doit toucher le verbe : « Blue Sonate FR recherche » ne nomme personne.
    if (name !== null && match[1].trimEnd().endsWith(name)) return name;
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
