/**
 * Fuseaux horaires des annonces GETI : lecture du fuseau écrit (« 21h CET »,
 * « 9pm EST », « UTC+1 », « heure FR »), conversion d'une heure écrite vers
 * l'heure de Paris, et instant d'une heure de Paris —
 * `docs/features/GETI_INFO.md` § Dates, annonces passées et fuseaux.
 *
 * L'heure de Paris se calcule sans `Intl` (règle européenne : heure d'été du
 * dernier dimanche de mars au dernier dimanche d'octobre, bascule à 1 h UTC) :
 * le filtre la lit pour chaque annonce de la liste. Les autres fuseaux nommés
 * passent par `Intl`, à l'analyse seulement.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import { NOT_AFTER_WORD, NOT_BEFORE_WORD, type GetiPreparedText } from "@/lib/shared/geti/normalize";

export const GETI_DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;

/** Fuseau par défaut : une annonce sans fuseau écrit parle à l'heure de Paris. */
export const GETI_PARIS_ZONE = "Europe/Paris";

/** Dernier dimanche d'un mois (`month` : 0–11), en millisecondes UTC à minuit. */
function lastSunday(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return lastDay.getTime() - lastDay.getUTCDay() * GETI_DAY_MS;
}

/**
 * Décalage de Paris sur UTC à un instant, en minutes : 120 en heure d'été
 * (du dernier dimanche de mars 1 h UTC au dernier dimanche d'octobre 1 h UTC),
 * 60 sinon.
 */
export function getiParisOffsetMinutes(instant: number): number {
  const year = new Date(instant).getUTCFullYear();
  const summerStart = lastSunday(year, 2) + 60 * MINUTE_MS;
  const summerEnd = lastSunday(year, 9) + 60 * MINUTE_MS;
  return instant >= summerStart && instant < summerEnd ? 120 : 60;
}

/** Fuseau reconnu : nommé (règle d'heure d'été du lieu) ou à décalage fixe (minutes sur UTC). */
export type GetiZoneRule = { iana: string } | { offset: number };

/** Sigles lus et le lieu dont ils suivent l'heure, été comme hiver (« CET » écrit en juillet reste l'heure de Paris). */
const ZONE_PLACES: Readonly<Record<string, string>> = {
  CET: GETI_PARIS_ZONE,
  CEST: GETI_PARIS_ZONE,
  BST: "Europe/London",
  WET: "Europe/London",
  WEST: "Europe/London",
  EET: "Europe/Helsinki",
  EEST: "Europe/Helsinki",
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
};

const FIXED_OFFSET = /^(?:UTC|GMT)(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/u;
/** Décalages fixes admis : de UTC−12 à UTC+14. */
const OFFSET_MIN = -12 * 60;
const OFFSET_MAX = 14 * 60;

/**
 * La règle d'un fuseau gardé (`availability.timezone` : « Europe/Paris »,
 * « CET », « UTC+1 », « EST »), `null` pour un texte inconnu ou hors borne.
 */
export function getiZoneRule(label: string | null | undefined): GetiZoneRule | null {
  if (typeof label !== "string") return null;
  if (label === GETI_PARIS_ZONE) return { iana: GETI_PARIS_ZONE };
  const code = label.toUpperCase();
  if (Object.hasOwn(ZONE_PLACES, code)) return { iana: ZONE_PLACES[code] };
  const fixed = FIXED_OFFSET.exec(code);
  if (fixed === null) return null;
  const extra = Number(fixed[3] ?? 0);
  const minutes = Number(fixed[2] ?? 0) * 60 + extra;
  const offset = fixed[1] === "-" ? -minutes : minutes;
  return extra < 60 && offset >= OFFSET_MIN && offset <= OFFSET_MAX ? { offset } : null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(iana: string): Intl.DateTimeFormat {
  let formatter = formatters.get(iana);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: iana,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(iana, formatter);
  }
  return formatter;
}

/** Décalage d'un fuseau sur UTC à un instant, en minutes. */
export function getiZoneOffsetMinutes(rule: GetiZoneRule, instant: number): number {
  if ("offset" in rule) return rule.offset;
  if (rule.iana === GETI_PARIS_ZONE) return getiParisOffsetMinutes(instant);
  const whole = Math.floor(instant / MINUTE_MS) * MINUTE_MS;
  const parts = formatterOf(rule.iana).formatToParts(new Date(whole));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return Math.round((wall - whole) / MINUTE_MS);
}

const PARIS_RULE: GetiZoneRule = { iana: GETI_PARIS_ZONE };

/**
 * Instant d'une heure locale : `day` (minuit du jour civil, en millisecondes
 * UTC) et `minutes` depuis minuit (au-delà de 1440 : le lendemain) dans le
 * fuseau `rule` (Paris par défaut). Une heure qui n'existe pas (nuit du passage
 * à l'heure d'été) est lue une heure plus tard.
 */
export function getiWallInstant(day: number, minutes: number, rule: GetiZoneRule = PARIS_RULE): number {
  const wall = day + minutes * MINUTE_MS;
  const first = wall - getiZoneOffsetMinutes(rule, wall) * MINUTE_MS;
  return wall - getiZoneOffsetMinutes(rule, first) * MINUTE_MS;
}

/** Jour civil d'un instant dans un fuseau (Paris par défaut), en millisecondes UTC à minuit de ce jour. */
export function getiCivilDay(instant: number, rule: GetiZoneRule = PARIS_RULE): number {
  const local = instant + getiZoneOffsetMinutes(rule, instant) * MINUTE_MS;
  return Math.floor(local / GETI_DAY_MS) * GETI_DAY_MS;
}

/**
 * Minutes à ajouter à une heure écrite dans le fuseau `rule` pour la lire à
 * l'heure de Paris, à l'instant de cette heure-là (`day`, `minutes`).
 */
export function getiParisShiftMinutes(rule: GetiZoneRule, day: number, minutes: number): number {
  const instant = getiWallInstant(day, minutes, rule);
  return getiParisOffsetMinutes(instant) - getiZoneOffsetMinutes(rule, instant);
}

/** Minutes depuis minuit ramenées dans la journée ; une fin de plage à minuit pile reste 1440. */
export function getiWrapMinutes(minutes: number, isEnd = false): number {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return wrapped === 0 && isEnd ? DAY_MINUTES : wrapped;
}

/** Mots qui suivent un « cet » démonstratif : « cet après-midi », « cet été », « cet horaire ». */
const CET_FOLLOWERS =
  "ete|apres|aprem|apm|hiver|automne|instant|horaire|evenement|event|endroit|effectif|objectif|esprit|etat|univers|environnement|age|elo|aspect|exercice|ensemble";
/**
 * « cet » démonstratif, pas un fuseau : « 15h cet après-midi », « 18 cet été ».
 * Texte sans accents, en minuscules.
 */
export const CET_DEMONSTRATIVE = String.raw`\s(?:${CET_FOLLOWERS})${NOT_BEFORE_WORD}`;
/** Les mêmes mots derrière « CET » en capitales (« CET APRÈS-MIDI », « CET après-midi »), texte sans accents. */
const CET_DEMONSTRATIVE_ANY_CASE = String.raw`\s(?:${CET_FOLLOWERS}|${CET_FOLLOWERS.toUpperCase()})${NOT_BEFORE_WORD}`;

/** Décalage écrit derrière UTC ou GMT : « +1 », « -5 », « +5:30 ». */
const OFFSET_SUFFIX = String.raw`(?:\s?[+-]\s?\d{1,2}(?::\d{2})?)?`;
/**
 * Sigles lus en capitales n'importe où : ceux qui ne sont pas des mots
 * (« CET APRÈS-MIDI » mis à part).
 */
const ZONE_CODE = new RegExp(
  String.raw`${NOT_AFTER_WORD}(CEST|CET(?!${CET_DEMONSTRATIVE_ANY_CASE})|(?:UTC|GMT)${OFFSET_SUFFIX})${NOT_BEFORE_WORD}`,
  "u",
);
/** Sigles européens qui sont aussi des mots en capitales (« EU WEST »). */
const EU_WORD_CODES = "BST|WEST|WET|EEST|EET";
/** Sigles américains qui sont aussi des mots en capitales (« NOTRE ÉQUIPE EST PRÊTE »). */
const US_CODES = "EST|EDT|CST|CDT|PST|PDT";
/** Heure en « 21h », « 21H30 ». */
const HOUR_UNIT = String.raw`\d ?[hH](?:\d{2})?`;
/** Heure en am/pm ou en « 21:00 ». */
const MERIDIEM_OR_CLOCK = String.raw`(?:\d ?[aApP][mM]|\d:\d{2})`;
/** Heure d'une plage sans unité qui ne peut pas être un palier de rang ni un score : de 6 à 24. */
const HOUR_LIKE = String.raw`(?:[6-9]|1\d|2[0-4])`;
/**
 * Plage sans unité : « 8-10 », « 20 - 22 » — une de ses bornes au moins vaut
 * 6 ou plus (« Diamond 1-3 WEST », « Master 1-2 EST », un score « 2-1 » n'en sont pas).
 */
const BARE_RANGE = String.raw`(?<!\d)(?:${HOUR_LIKE} ?- ?\d{1,2}|\d{1,2} ?- ?${HOUR_LIKE})(?!\d)`;
/** Sigles que la parenthèse ne suffit pas à lire : « EU (WEST) » est une région de serveur. */
const PAREN_CODES = "BST|WET|EEST|EET|" + US_CODES;
/** Sujet français juste avant : « QUI EST 8PM » est du français (« est »), pas un fuseau. */
const FRENCH_SUBJECT_BEFORE = String.raw`(?<!(?:^|[^\p{L}])(?:[Qq][Uu][Ii]|[Ii][Ll]|[Ee][Ll][Ll][Ee]|[Cc][Ee]|[ÇçCc][Aa]|[Oo][Nn]|[Qq][Uu][Ee]|[Tt][Oo][Uu][Tt]|[Rr][Ii][Ee][Nn]) )`;
/** Début d'un sigle : ni collé à un mot, ni derrière une apostrophe (« C'EST »). */
const CODE_START = String.raw`${NOT_AFTER_WORD}(?<!['\u2019])`;
/**
 * Sigles qui sont aussi des mots en capitales, lus seulement là où ils ne
 * peuvent être qu'un fuseau :
 * - derrière une heure — européens derrière « 21H », une heure en am/pm, en
 *   « 21:00 » ou une plage « 20-22 » (jamais un rang, « 3K5 WEST », « 4500 WEST ») ;
 *   américains derrière les mêmes, sauf « 21H » (« 21H EST BON » reste du français) ;
 * - derrière une étiquette (« Timezone: EST », « TZ EST », « fuseau : PST »,
 *   « in EST » pour un sigle américain), entre parenthèses (« (EST) » ; jamais
 *   « (WEST) », la région « EU (WEST) ») ;
 * - devant une heure en am/pm (« EST 9PM » ; « QUI EST 8PM » reste du français).
 */
const ZONE_CODE_AFTER_TIME = new RegExp(
  [
    String.raw`(?:${HOUR_UNIT}|${MERIDIEM_OR_CLOCK}|${BARE_RANGE}) ?\(?(${EU_WORD_CODES})${NOT_BEFORE_WORD}`,
    String.raw`(?:${MERIDIEM_OR_CLOCK}|${BARE_RANGE}) ?\(?(${US_CODES})${NOT_BEFORE_WORD}`,
    String.raw`${NOT_AFTER_WORD}(?:[Tt][Ii][Mm][Ee] ?[Zz][Oo][Nn][Ee]|[Tt][Zz]|[Ff][Uu][Ss][Ee][Aa][Uu])\s?:?\s?\(?(${EU_WORD_CODES}|${US_CODES})${NOT_BEFORE_WORD}`,
    String.raw`${NOT_AFTER_WORD}[Ii][Nn]\s(${US_CODES})${NOT_BEFORE_WORD}`,
    String.raw`\((${PAREN_CODES})\)`,
    String.raw`${CODE_START}${FRENCH_SUBJECT_BEFORE}(${EU_WORD_CODES}|${US_CODES}) ?\d{1,2}(?::\d{2})? ?[aApP][mM]${NOT_BEFORE_WORD}`,
  ].join("|"),
  "u",
);
/** … ou en minuscules derrière une heure : « 20-22 cet », « 21h cest », « 20-22 utc+1 » (« cet été » n'en est pas un). */
const ZONE_AFTER_TIME = new RegExp(
  String.raw`\d ?h? ?\(?(cest|cet(?!${CET_DEMONSTRATIVE})|(?:utc|gmt)${OFFSET_SUFFIX}|bst|eest|eet)${NOT_BEFORE_WORD}`,
  "u",
);
/** Sigles américains en minuscules : derrière une heure en am/pm seulement (« 9pm est » ; « 21h est bien » reste du français). */
const ZONE_AFTER_MERIDIEM = new RegExp(String.raw`\d ?(?:am|pm) ?\(?(est|edt|cst|cdt|pst|pdt)${NOT_BEFORE_WORD}`, "u");
/** Heure de Paris écrite en mots : « heure française », « heure FR », « 21h FR », « Paris time ». */
const PARIS_TIME = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:heure francaise|heure de paris|heure de france|heure fr|french time|france time|paris time|fr time)${NOT_BEFORE_WORD}|\d ?h(?:\d{2})? ?\(?fr${NOT_BEFORE_WORD}`,
  "u",
);
/** Heure du Québec écrite en mots (celle de New York). */
const QUEBEC_TIME = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?:heure (?:du quebec|de montreal|quebecoise|qc)|quebec time|montreal time)${NOT_BEFORE_WORD}`,
  "u",
);

function codeAfterTime(plain: string): string | undefined {
  const match = ZONE_CODE_AFTER_TIME.exec(plain);
  return match?.slice(1).find((code) => code !== undefined);
}

/**
 * Fuseau écrit dans l'annonce : « Europe/Paris » pour l'heure de Paris écrite
 * en mots, sinon le sigle tel qu'écrit, en capitales et sans espace (« CET »,
 * « UTC+1 », « EST ») ; `null` si aucun n'est écrit, ou si son décalage est
 * hors borne.
 */
export function parseGetiTimezone(prepared: GetiPreparedText): string | null {
  if (PARIS_TIME.test(prepared.lower)) return GETI_PARIS_ZONE;
  if (QUEBEC_TIME.test(prepared.lower)) return "EST";
  const found =
    ZONE_CODE.exec(prepared.plain)?.[1] ??
    codeAfterTime(prepared.plain) ??
    ZONE_AFTER_TIME.exec(prepared.lower)?.[1] ??
    ZONE_AFTER_MERIDIEM.exec(prepared.lower)?.[1];
  if (found === undefined) return null;
  const label = found.replace(/\s/gu, "").toUpperCase();
  return getiZoneRule(label) === null ? null : label;
}
