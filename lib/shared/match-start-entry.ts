/**
 * Saisie d'une date de début de match **sans année**.
 *
 * Le staff ne programme jamais un match à plus de trois mois : demander
 * l'année, c'est demander une information que le contexte donne déjà, et
 * offrir une occasion de se tromper (« 2026 » laissé en janvier 2027). Le
 * dialogue ne demande donc que le jour, le mois et l'heure — à l'heure de
 * Paris — et l'année se **déduit** ici, par une règle pure et testée.
 *
 * La règle : parmi les années `Y - 1`, `Y` et `Y + 1` (`Y` = année, à Paris,
 * de l'instant de référence), on garde la date la plus proche de la référence
 * (`matchEntryReference` : début du tournoi ou aujourd'hui). Une date de ±6 mois autour de la référence tombe toujours sur
 * la bonne année, ce qui couvre largement l'horizon de trois mois.
 *
 * Le serveur ne voit rien de tout cela : il reçoit l'instant complet (ISO),
 * validé comme avant par `normalizeMatchStartAt`.
 */

import { matchStartAtTime, normalizeMatchStartAt, type MatchScheduleInput } from "@/lib/shared/match-schedule";

/** Fuseau de la saisie et de l'aperçu : celui de l'organisation. */
export const MATCH_ENTRY_TIME_ZONE = "Europe/Paris";

/** Jour, mois (1–12), heure et minute, lus à l'heure de Paris. */
export type MatchStartEntry = {
  day: number;
  month: number;
  hour: number;
  minute: number;
};

const PARIS_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: MATCH_ENTRY_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

const DAY_MS = 24 * 60 * 60 * 1000;

type ParisParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function parisParts(instant: number): ParisParts {
  const parts: Record<string, number> = {};
  for (const part of PARIS_PARTS.formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** L'heure de Paris d'un instant, écrite comme si c'était de l'UTC (ms). */
function parisWallClock(instant: number): number {
  const p = parisParts(instant);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Avance de Paris sur l'UTC à cet instant (ms) : 1 h l'hiver, 2 h l'été. */
function parisOffset(instant: number): number {
  return parisWallClock(instant) - instant;
}

/**
 * Instant d'une heure de Paris.
 *
 * Les deux changements d'heure sont tranchés comme le fait `Date` :
 * - **heure avalée** (dernier dimanche de mars, 2 h → 3 h) : 2 h 30 n'existe
 *   pas, on la lit avec le décalage d'avant le changement, ce qui donne 3 h 30
 *   — l'aperçu du dialogue le montre avant l'envoi ;
 * - **heure doublée** (dernier dimanche d'octobre, 3 h → 2 h) : 2 h 30 a lieu
 *   deux fois, on retient la première (heure d'été).
 */
export function parisInstant(year: number, month: number, day: number, hour: number, minute: number): number {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // Les deux décalages possibles autour de la date : celui de la veille et
  // celui du lendemain (identiques hors des nuits de changement d'heure).
  const before = parisOffset(target - DAY_MS);
  const after = parisOffset(target + DAY_MS);
  const exact = [target - before, target - after].filter((instant) => parisWallClock(instant) === target);
  if (exact.length > 0) return Math.min(...exact);
  return target - before;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Vrai si les quatre composantes sont dans leurs bornes (jour ≤ 31, sans regarder le mois). */
export function isMatchStartEntryInRange(entry: MatchStartEntry): boolean {
  return (
    isIntegerIn(entry.day, 1, 31) &&
    isIntegerIn(entry.month, 1, 12) &&
    isIntegerIn(entry.hour, 0, 23) &&
    isIntegerIn(entry.minute, 0, 59)
  );
}

/**
 * Référence de la déduction :
 *
 * 1. le début du tournoi s'il est **terminé** (correction d'archive) ;
 * 2. sinon le plus tardif du début du tournoi et de `now` : un tournoi à venir
 *    se programme autour de son début, un tournoi en cours — une ligue qui
 *    dure des mois — autour d'aujourd'hui, puisqu'aucun match ne se programme
 *    à plus de trois mois ;
 * 3. `now` si le début est illisible.
 *
 * La date déjà posée sur le match n'entre **pas** en compte : elle ancrerait
 * l'année sur une erreur ou sur un report, sans aucun moyen d'en sortir (le
 * dialogue n'a pas de champ année). L'aperçu montre l'année retenue.
 */
export function matchEntryReference(
  input: Readonly<{
    tournamentStartAt: MatchScheduleInput["startAt"];
    tournamentFinished: boolean;
  }>,
  now: number,
): number {
  const tournamentStart = matchStartAtTime({ startAt: input.tournamentStartAt });
  if (tournamentStart === null) return now;
  return input.tournamentFinished ? tournamentStart : Math.max(tournamentStart, now);
}

/**
 * Instant (ms) d'une saisie sans année : parmi `Y - 1`, `Y`, `Y + 1`, la date
 * la plus proche de `reference`. Une année où le jour n'existe pas (31 avril,
 * 29 février hors bissextile) est écartée ; `null` si aucune ne convient, ou si
 * la saisie sort de ses bornes. À égalité parfaite, la plus ancienne l'emporte
 * (cas théorique : il faudrait deux candidates à six mois pile).
 */
export function resolveMatchStartEntry(entry: MatchStartEntry, reference: number): number | null {
  if (!isMatchStartEntryInRange(entry) || !Number.isFinite(reference)) return null;
  const referenceYear = parisParts(reference).year;

  let best: number | null = null;
  for (const year of [referenceYear - 1, referenceYear, referenceYear + 1]) {
    if (entry.day > daysInMonth(year, entry.month)) continue;
    const instant = parisInstant(year, entry.month, entry.day, entry.hour, entry.minute);
    if (normalizeMatchStartAt(instant) === null) continue;
    if (best === null || Math.abs(instant - reference) < Math.abs(best - reference)) best = instant;
  }
  return best;
}

/**
 * Jour, mois et heure de Paris d'une date déjà programmée — de quoi
 * pré-remplir le dialogue. `null` si la date est absente ou illisible.
 */
export function matchStartEntryOf(startAt: MatchScheduleInput["startAt"]): MatchStartEntry | null {
  const time = matchStartAtTime({ startAt });
  if (time === null) return null;
  const p = parisParts(time);
  return { day: p.day, month: p.month, hour: p.hour, minute: p.minute };
}

const PARIS_FULL = new Intl.DateTimeFormat("fr-FR", {
  timeZone: MATCH_ENTRY_TIME_ZONE,
  dateStyle: "full",
  timeStyle: "short",
});

/**
 * Date complète, année comprise, à l'heure de Paris
 * (« samedi 3 janvier 2027 à 20:00 ») : l'aperçu que l'organisateur vérifie
 * avant d'enregistrer, puisqu'il n'a pas saisi l'année lui-même.
 */
export function formatMatchStartEntryPreview(instant: number): string {
  return PARIS_FULL.format(new Date(instant));
}

/** Noms des mois, pour la liste du dialogue (index 0 = janvier). */
export const MATCH_ENTRY_MONTHS: readonly string[] = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/** Valeur `HH:MM` d'un `<input type="time">`. */
export function matchEntryTimeValue(entry: Pick<MatchStartEntry, "hour" | "minute">): string {
  return `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`;
}

/** Heure et minute d'une valeur `HH:MM` (secondes tolérées), `null` si illisible. */
export function parseMatchEntryTime(value: string): Pick<MatchStartEntry, "hour" | "minute"> | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!isIntegerIn(hour, 0, 23) || !isIntegerIn(minute, 0, 59)) return null;
  return { hour, minute };
}

/** Champs du dialogue, dans leur ordre d'affichage. */
export type MatchStartEntryField = "day" | "month" | "time";

/** Ce que les trois champs du dialogue, tels que saisis, produisent. */
export type MatchStartEntryState =
  /** Les trois champs vides : la date est effacée. */
  | { kind: "empty" }
  /** Saisie commencée : `field` est le premier champ manquant ou illisible. */
  | { kind: "incomplete"; field: MatchStartEntryField }
  /** Jour absent de ce mois dans les trois années candidates (31 avril…). */
  | { kind: "invalid"; field: MatchStartEntryField }
  | { kind: "ready"; instant: number };

/**
 * Lecture des trois champs bruts du dialogue (`day`, `month` : valeur d'une
 * liste, `""` = non choisi ; `time` : valeur d'un `<input type="time">`).
 * `timeBadInput` : le champ heure porte une saisie partielle, qu'il rend comme
 * `""` — indiscernable d'un champ vide sans ce drapeau.
 *
 * `currentStartAt` : date déjà posée sur le match. Tant que le jour et le mois
 * restent les siens, **son année est gardée** — retoucher l'heure, ou
 * enregistrer sans rien changer, ne déplace jamais un match d'un an. Changer
 * le jour ou le mois relance la déduction.
 */
export function readMatchStartEntry(
  raw: Readonly<{ day: string; month: string; time: string; timeBadInput: boolean }>,
  reference: number,
  currentStartAt: MatchScheduleInput["startAt"] = null,
): MatchStartEntryState {
  const day = raw.day === "" ? null : Number(raw.day);
  const month = raw.month === "" ? null : Number(raw.month);
  const timeBlank = raw.time.trim() === "";
  const time = timeBlank ? null : parseMatchEntryTime(raw.time);

  if (day === null && month === null && timeBlank && !raw.timeBadInput) return { kind: "empty" };
  if (day === null || !isIntegerIn(day, 1, 31)) return { kind: "incomplete", field: "day" };
  if (month === null || !isIntegerIn(month, 1, 12)) return { kind: "incomplete", field: "month" };
  if (time === null) return { kind: "incomplete", field: "time" };

  const current = matchStartAtTime({ startAt: currentStartAt });
  if (current !== null) {
    const kept = parisParts(current);
    if (kept.day === day && kept.month === month) {
      return { kind: "ready", instant: parisInstant(kept.year, month, day, time.hour, time.minute) };
    }
  }

  const instant = resolveMatchStartEntry({ day, month, ...time }, reference);
  return instant === null ? { kind: "invalid", field: "day" } : { kind: "ready", instant };
}

/**
 * Même jour, même heure de Paris, `years` années plus tard (ou plus tôt) ;
 * `null` si ce jour n'existe pas cette année-là (29 février) ou sort des
 * bornes du serveur.
 *
 * C'est l'échappatoire de la déduction : elle tombe juste à six mois près
 * autour de sa référence, et rien d'autre ne permettrait de corriger l'archive
 * d'un match joué il y a plus longtemps, ni une année déjà fausse. Le dialogue
 * ne **demande** pas l'année ; il offre seulement de la décaler quand l'aperçu
 * montre la mauvaise.
 */
export function shiftMatchStartYear(instant: number, years: number): number | null {
  if (!Number.isInteger(years) || !Number.isFinite(instant)) return null;
  const p = parisParts(instant);
  const year = p.year + years;
  if (p.day > daysInMonth(year, p.month)) return null;
  const shifted = parisInstant(year, p.month, p.day, p.hour, p.minute);
  return normalizeMatchStartAt(shifted) === null ? null : shifted;
}

/** Applique le décalage d'année choisi à une saisie prête ; les autres états passent tels quels. */
export function withYearShift(state: MatchStartEntryState, years: number): MatchStartEntryState {
  if (state.kind !== "ready" || years === 0) return state;
  const instant = shiftMatchStartYear(state.instant, years);
  return instant === null ? { kind: "invalid", field: "day" } : { kind: "ready", instant };
}

/** Année de Paris d'un instant (libellé des boutons de décalage). */
export function matchStartParisYear(instant: number): number {
  return parisParts(instant).year;
}
