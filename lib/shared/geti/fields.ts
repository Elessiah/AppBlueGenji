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
  EU: ["eu", "euw", "eune", "europe", "european", "europeen", "europeenne", "emea"],
  NA: ["na", "nae", "naw", "north america", "amerique du nord"],
  LATAM: ["latam", "south america", "latin america", "amerique du sud", "amerique latine"],
  ASIA: ["asia", "asie", "apac", "korea", "coree", "kr"],
  OCE: ["oce", "oceania", "oceanie", "australia", "australie"],
};

const findRegions = aliasFinder(GETI_REGIONS, REGION_ALIASES);

/**
 * Régions visées (mêmes mots que le relais du bot, Océanie en plus).
 *
 * @param lower Texte sans accents, en minuscules.
 * @param rawText Texte d'origine, où lire le drapeau européen.
 * @returns Les régions, dans l'ordre de `GETI_REGIONS`.
 */
export function parseGetiRegions(lower: string, rawText: string): GetiRegion[] {
  const found = findRegions(lower);
  return getiFlagCodes(rawText).includes("EU") ? inReferenceOrder(GETI_REGIONS, [...found, "EU"]) : found;
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
/** Une durée n'est pas une heure : « 2h par jour », « 3h de jeu ». */
const DURATION_AFTER = /^\s?(?:par|de jeu|de scrim|per|a day|\/\s?(?:jour|day|semaine|week))/u;

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

function parseTimes(lower: string): GetiTimeRange[] {
  const times: GetiTimeRange[] = [];
  let rest = lower;
  for (const match of lower.matchAll(TIME_RANGE)) {
    const first = timeParts(match, 1);
    const second = timeParts(match, 1 + TIME_ATOM_GROUPS);
    // « 3-5 joueurs » : sans unité sur la seconde heure, ce n'est pas un horaire.
    if (!second.explicit) continue;
    const from = toMinutes(first, first.meridiem ?? second.meridiem);
    const to = toMinutes(second, second.meridiem);
    if (from === null || to === null) continue;
    times.push({ from, to });
    // La fourchette lue est effacée : ses heures ne se relisent pas une à une.
    rest = rest.slice(0, match.index) + " ".repeat(match[0].length) + rest.slice(match.index + match[0].length);
  }
  for (const match of rest.matchAll(TIME_SINGLE)) {
    const parts = timeParts(match, 1);
    if (!parts.explicit) continue;
    const end = match.index + match[0].length;
    if (DURATION_AFTER.test(rest.slice(end, end + 12))) continue;
    const from = toMinutes(parts, parts.meridiem);
    if (from !== null) times.push({ from, to: null });
  }
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
const MIN_AGE_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`${NOT_AFTER_WORD}${AGE}\s?\+`, "u"),
  new RegExp(String.raw`(?<![\p{L}\p{N}:])\+\s?${AGE}${NOT_BEFORE_WORD}`, "u"),
  new RegExp(
    String.raw`${NOT_AFTER_WORD}${AGE}\s?(?:ans|yo|y/o|years old|years)\s?(?:min|minimum|mini|ou plus|et plus|or older|and older|and up)${NOT_BEFORE_WORD}`,
    "u",
  ),
  new RegExp(
    String.raw`${NOT_AFTER_WORD}(?:min|minimum|au moins|at least)\s?:?\s?${AGE}\s?(?:ans|yo|y/o|years)${NOT_BEFORE_WORD}`,
    "u",
  ),
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
  for (const pattern of MIN_AGE_PATTERNS) {
    const match = pattern.exec(lower);
    if (match !== null) return Number(match[1]);
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
  ]
    .join(" ")
    .split(" "),
);

function nameKey(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isNameWord(word: string): boolean {
  const key = nameKey(word);
  return key !== "" && !NOT_A_NAME.has(key) && !/^[bsgpdmc][1-5]$/u.test(key);
}

function cleanTeamName(candidate: string): string | null {
  const words = candidate.split(/\s+/u).filter((word) => word !== "");
  // Le nom s'arrête au premier mot du vocabulaire d'annonce : « Blue Phoenix EU ».
  const stop = words.findIndex((word) => !isNameWord(word));
  const kept = stop === -1 ? words : words.slice(0, stop);
  const name = visibleText(kept.join(" ")).replace(/[.'-]+$/u, "");
  return name === "" || name.length > GETI_TEAM_NAME_MAX ? null : name;
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
    const name = cleanTeamName(match[1]);
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
