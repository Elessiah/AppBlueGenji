/**
 * Date butoir de planification d'un match (`docs/features/SCHEDULE_DEADLINE.md`)
 * — la règle, sans base ni réseau.
 *
 * Dans un tournoi dont l'arbitrage planifie les matchs (`referee_scheduling`),
 * l'arbitrage peut fixer à un match une **date butoir** : les deux engagées
 * doivent s'accorder sur un horaire, que l'arbitrage pose, avant elle. Passée
 * la date butoir, un match toujours à planifier (ses deux engagées connues)
 * est clos en **double forfait** par le balayage
 * (`lib/server/tournaments/schedule-deadline.ts`).
 *
 * La date butoir sert aussi au planning des casts et arbitres : chaque match
 * planifié y est **confirmé** au plus tôt de sa date butoir et de son début
 * moins le délai de confirmation (`planningConfirmAt`).
 */
import { parisInstant, parisParts } from "./match-start-entry";
import { matchLaunchPhase, type MatchLaunchInput } from "./match-launch";
import { cached } from "./intl-cache";
import { INTL_LOCALE, type Locale } from "./locales";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

/** Heure (Paris) de la date butoir par défaut : 21:00. */
export const SCHEDULE_DEADLINE_DEFAULT_HOUR = 21;
/** Jours calendaires (Paris) entre l'ouverture de la planification et la date butoir par défaut. */
export const SCHEDULE_DEADLINE_DEFAULT_DAYS = 2;
/**
 * Une date butoir se pose au moins 24 heures devant — le préavis minimal d'un
 * match : les engagées doivent avoir le temps de s'accorder, et l'arbitrage
 * celui de poser l'horaire. Une saisie hâtive (ou malveillante) ne peut pas
 * forfaiter une manche entière dans l'heure.
 */
export const SCHEDULE_DEADLINE_MIN_AHEAD_MS = 24 * HOUR_MS;
/**
 * Préavis minimal d'une paire : une date butoir ne frappe que si son premier
 * avis **remis** (message privé ou push parti) l'a été au moins douze heures
 * avant elle (`deadlineArmed`) — la moitié du préavis minimal de la pose : une
 * paire complétée ou prévenue plus tard n'a plus le temps de s'accorder.
 */
export const SCHEDULE_DEADLINE_ARM_MIN_MS = 12 * HOUR_MS;
/**
 * Préavis minimal d'une date butoir de manche **reposée** en masse pour les
 * matchs remplis depuis : {@link SCHEDULE_DEADLINE_ARM_MIN_MS} plus une heure
 * de marge — l'annonce se réserve après la pose (balayage suivant, verrou
 * tenu, nouvel essai si le bot ne répond pas) et doit encore partir à temps
 * pour l'armer.
 */
export const SCHEDULE_DEADLINE_REAPPLY_MIN_MS = SCHEDULE_DEADLINE_ARM_MIN_MS + HOUR_MS;
/** …et au plus soixante jours devant : au-delà, c'est une faute de saisie. */
export const SCHEDULE_DEADLINE_MAX_AHEAD_MS = 60 * DAY_MS;

/**
 * Date butoir proposée quand la planification s'ouvre à `openedAt` : **21:00,
 * heure de Paris, deux jours calendaires plus tard** (dimanche 23:00 → mardi
 * 21:00 ; lundi 10:00 → mercredi 21:00). Le changement d'heure ne décale pas
 * l'heure murale : 21:00 reste 21:00 à Paris.
 */
export function defaultScheduleDeadline(openedAt: number): number {
  const p = parisParts(openedAt);
  // `Date.UTC` normalise un 32 du mois en 1er du suivant.
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day + SCHEDULE_DEADLINE_DEFAULT_DAYS));
  return parisInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), SCHEDULE_DEADLINE_DEFAULT_HOUR, 0);
}

/** Refus d'une date butoir reçue. */
export type ScheduleDeadlineRefusal = "INVALID_SCHEDULE_DEADLINE" | "SCHEDULE_DEADLINE_TOO_SOON" | "SCHEDULE_DEADLINE_TOO_FAR";

export type ScheduleDeadlineInput =
  | { kind: "clear" }
  | { kind: "set"; at: number }
  | { kind: "invalid"; code: ScheduleDeadlineRefusal };

/**
 * Lit la date butoir reçue (`null` efface ; chaîne ISO sinon), contre l'horloge
 * `now`, au moins `minAheadMs` devant elle (par défaut
 * {@link SCHEDULE_DEADLINE_MIN_AHEAD_MS} ; la date d'une manche **reposée**
 * pour ses nouveaux matchs se contente de {@link SCHEDULE_DEADLINE_REAPPLY_MIN_MS}).
 * Arrondie à la minute : la colonne `DATETIME` n'a pas de fractions, et
 * l'horaire annoncé doit être celui que la base garde.
 */
export function readScheduleDeadline(
  raw: unknown,
  now: number,
  minAheadMs: number = SCHEDULE_DEADLINE_MIN_AHEAD_MS,
): ScheduleDeadlineInput {
  if (raw === null) return { kind: "clear" };
  if (typeof raw !== "string" || raw.length > 40) return { kind: "invalid", code: "INVALID_SCHEDULE_DEADLINE" };
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return { kind: "invalid", code: "INVALID_SCHEDULE_DEADLINE" };
  const at = parsed - (((parsed % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);
  if (at < now + minAheadMs) return { kind: "invalid", code: "SCHEDULE_DEADLINE_TOO_SOON" };
  if (at > now + SCHEDULE_DEADLINE_MAX_AHEAD_MS) return { kind: "invalid", code: "SCHEDULE_DEADLINE_TOO_FAR" };
  return { kind: "set", at };
}

/** Ce que la règle lit d'un match. */
export type DeadlineMatch = Pick<MatchLaunchInput, "status" | "team1Id" | "team2Id" | "startAt" | "launchedAt" | "refereeScheduling">;

/**
 * Une date butoir peut-elle se poser sur ce match : tournoi planifié par
 * l'arbitrage, match non joué, sans horaire et non lancé. Ses engagées peuvent
 * être encore inconnues (la date butoir d'une manche se pose d'avance) : elle
 * s'éteint alors sans effet si elles ne le sont toujours pas à l'échéance.
 */
export function acceptsScheduleDeadline(match: DeadlineMatch): boolean {
  return (
    match.refereeScheduling &&
    match.status !== "COMPLETED" &&
    match.status !== "AWAITING_CONFIRMATION" &&
    match.startAt === null &&
    match.launchedAt === null
  );
}

/** Ce que fait le balayage d'une date butoir échue : double forfait, retrait, ou elle s'éteint. */
export type DeadlineOutcome = "FORFEIT" | "RETIRE" | "LAPSE" | null;

/**
 * L'issue d'une date butoir (`null` : pas encore échue, ou le match est joué).
 *
 * - toujours **à planifier** (deux engagées connues, ni date ni lancement,
 *   option allumée) → **double forfait** ;
 * - match déjà programmé ou lancé → la date butoir est **retirée**
 *   (`SCHEDULE_DEADLINE_RETIRED_KEY`) : elle ne frappera plus, même si le
 *   match repasse à planifier (horaire retiré, lancement défait), mais reste
 *   lue par le planning (confirmation d'office à la date butoir) ;
 * - sans horaire mais une engagée manquante, ou option éteinte → elle
 *   **s'éteint** (effacée) : rien à forfaiter.
 */
export function deadlineOutcome(match: DeadlineMatch, deadlineAt: number | null, now: number): DeadlineOutcome {
  if (deadlineAt === null || deadlineAt > now) return null;
  if (match.status === "COMPLETED" || match.status === "AWAITING_CONFIRMATION") return null;
  if (match.startAt !== null || match.launchedAt !== null) return "RETIRE";
  return matchLaunchPhase(match, now) === "TO_PLAN" ? "FORFEIT" : "LAPSE";
}

/**
 * La date butoir a-t-elle été **armée** pour la paire actuelle assez tôt pour
 * frapper : son premier avis (`armedAt`, envoyé alors que le match était à
 * planifier avec ces deux engagées) part au moins
 * {@link SCHEDULE_DEADLINE_ARM_MIN_MS} avant elle. Une paire complétée trop tard (match
 * d'origine fini juste avant), ou changée après l'annonce, n'est jamais
 * forfaitée : la date butoir s'éteint.
 */
export function deadlineArmed(armedAt: number | null, deadlineAt: number): boolean {
  return armedAt !== null && armedAt <= deadlineAt - SCHEDULE_DEADLINE_ARM_MIN_MS;
}

/** Ce que lit {@link scheduleOpenedAt} d'un match du tournoi. */
export type OpenedAtMatch = {
  status: string;
  updatedAt: string;
  nextWinnerMatchId?: number | null;
  nextLoserMatchId?: number | null;
};

/** Une ouverture plus ancienne que ce délai n'est plus celle de la manche en cours. */
export const SCHEDULE_OPENED_LOOKBACK_MS = 7 * DAY_MS;

/**
 * Quand la planification s'est ouverte : la fin du dernier match joué (dimanche
 * 23:00 pour une manche finie dimanche soir) — pour un match visé
 * (`targetMatchId`), celle des matchs qui l'alimentent (vainqueur ou perdant),
 * sinon du tournoi —, et `now` si rien n'a été joué depuis une semaine (ou
 * horloge incohérente). La fin d'un match se lit à sa dernière écriture
 * (`updatedAt`) : la base ne garde pas d'instant de clôture.
 */
export function scheduleOpenedAt(matches: readonly OpenedAtMatch[], now: number, targetMatchId: number | null = null): number {
  if (targetMatchId !== null) {
    const feeders = matches.filter((match) => match.nextWinnerMatchId === targetMatchId || match.nextLoserMatchId === targetMatchId);
    const fromFeeders = latestCompletion(feeders, now);
    if (fromFeeders !== null) return fromFeeders;
  }
  return latestCompletion(matches, now) ?? now;
}

function latestCompletion(matches: readonly OpenedAtMatch[], now: number): number | null {
  let latest: number | null = null;
  for (const match of matches) {
    if (match.status !== "COMPLETED") continue;
    const at = Date.parse(match.updatedAt);
    if (!Number.isFinite(at) || at > now || at < now - SCHEDULE_OPENED_LOOKBACK_MS) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

/**
 * Date butoir proposée à la saisie : celle d'usage depuis l'ouverture
 * (`defaultScheduleDeadline(openedAt)`), ou depuis `now` si elle est déjà trop
 * proche pour être acceptée.
 */
export function suggestedScheduleDeadline(openedAt: number, now: number): number {
  const fromOpening = defaultScheduleDeadline(openedAt);
  return fromOpening >= now + SCHEDULE_DEADLINE_MIN_AHEAD_MS ? fromOpening : defaultScheduleDeadline(now);
}

// ─────────────────────────────────────────────────────────────────────────────
// Avis aux engagées
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paliers des avis aux engagées : l'annonce (`SET`, dès que la date butoir est
 * posée), puis 24 h et 3 h avant. Un palier déjà ouvert quand un plus proche
 * l'est aussi est consommé avec lui : un seul message part, le plus récent.
 */
export const SCHEDULE_DEADLINE_REMINDERS = [
  { key: "SET", beforeMs: Number.POSITIVE_INFINITY },
  { key: "DL24", beforeMs: 24 * HOUR_MS },
  { key: "DL3", beforeMs: 3 * HOUR_MS },
] as const;

export type DeadlineReminderKey = (typeof SCHEDULE_DEADLINE_REMINDERS)[number]["key"];

/** Clé de l'avis du double forfait prononcé (une fois par match). */
export const SCHEDULE_DEADLINE_FORFEIT_KEY = "FORFEIT";

/**
 * Marque (jamais envoyée) d'une date butoir **échue sur un match programmé ou
 * lancé** : elle ne frappera plus — même si l'horaire est retiré ou le
 * lancement défait —, mais reste sur le match, où le planning la lit encore
 * (`planningConfirmAt`). Effacée avec les avis quand la date butoir change.
 */
export const SCHEDULE_DEADLINE_RETIRED_KEY = "RETIRED";

/**
 * Le palier à envoyer maintenant (`null` : aucun) et ceux qu'il consomme.
 * Rien à l'échéance ni après : le balayage tranche alors le match.
 */
export function dueDeadlineReminder(
  deadlineAt: number,
  now: number,
  sent: ReadonlySet<string>,
): { key: DeadlineReminderKey; consumes: DeadlineReminderKey[] } | null {
  if (now >= deadlineAt) return null;
  const opened = SCHEDULE_DEADLINE_REMINDERS.filter((step) => deadlineAt - step.beforeMs <= now);
  if (opened.length === 0) return null;
  const latest = opened[opened.length - 1];
  if (sent.has(latest.key)) return null;
  return { key: latest.key, consumes: opened.map((step) => step.key) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning : quand confirmer
// ─────────────────────────────────────────────────────────────────────────────

/** Délai de confirmation du planning, en heures : bornes du réglage (≥ les 24 h de préavis d'un match). */
export const PLANNING_CONFIRM_LEAD_BOUNDS = [24, 168] as const;
export const DEFAULT_PLANNING_CONFIRM_LEAD_HOURS = 24;

/**
 * Instant où une entrée du planning se **confirme** d'office :
 * `min(date butoir, début − délai)`. Un match planifié vite (lundi soir, date
 * butoir mardi 21:00) se confirme à son propre délai, sans attendre la date
 * butoir ; un match lointain, à la date butoir, avec tout ce qui est planifié
 * d'ici là. Sans date butoir (tournoi entier, tournoi qui n'en pose pas) :
 * `début − délai`.
 */
export function planningConfirmAt(startAt: number, deadlineAt: number | null, leadHours: number): number {
  const byLead = startAt - leadHours * HOUR_MS;
  return deadlineAt === null ? byLead : Math.min(deadlineAt, byLead);
}

// ─────────────────────────────────────────────────────────────────────────────
// Saisie (jour + heure, heure de Paris)
// ─────────────────────────────────────────────────────────────────────────────

/** Jours proposés à la saisie : aujourd'hui (Paris) et les suivants. */
export const SCHEDULE_DEADLINE_ENTRY_DAYS = 21;


function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Les jours (Paris) proposés à la saisie, d'aujourd'hui à `count − 1` jours plus tard. */
export function deadlineEntryDays(now: number, count: number = SCHEDULE_DEADLINE_ENTRY_DAYS): string[] {
  const p = parisParts(now);
  return Array.from({ length: count }, (_, offset) => {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
    return dayKey(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
  });
}

/**
 * Une date butoir saisie est-elle acceptée (même borne que
 * {@link readScheduleDeadline}) : au moins 24 heures devant et au plus
 * soixante jours, ou l'une des dates de manche `reapply` encore reposables
 * (au moins {@link SCHEDULE_DEADLINE_REAPPLY_MIN_MS} devant).
 */
export function deadlineEntryAcceptable(at: number, now: number, reapply: readonly number[] = []): boolean {
  if (at > now + SCHEDULE_DEADLINE_MAX_AHEAD_MS) return false;
  if (at >= now + SCHEDULE_DEADLINE_MIN_AHEAD_MS) return true;
  return at >= now + SCHEDULE_DEADLINE_REAPPLY_MIN_MS && reapply.includes(at);
}

/**
 * Les dates butoir en place sur les matchs pas encore joués, qu'une saisie en
 * masse peut **reposer** pour les matchs remplis depuis, même à moins de 24
 * heures (encore assez loin pour qu'une annonce l'arme,
 * {@link SCHEDULE_DEADLINE_REAPPLY_MIN_MS}) — toutes : un tournoi à plusieurs
 * manches ouvertes (haut et bas de tableau) en porte plusieurs. À l'heure
 * pile seulement : la saisie va d'heure en heure ({@link deadlineEntryHours}),
 * une date posée à une autre minute ne pourrait être choisie. Croissantes,
 * sans doublon.
 */
export function roundScheduleDeadlines(
  matches: readonly { status: string; scheduleDeadlineAt: string | null }[],
  now: number,
): number[] {
  const found = new Set<number>();
  for (const match of matches) {
    if (match.status === "COMPLETED" || match.scheduleDeadlineAt === null) continue;
    const at = Date.parse(match.scheduleDeadlineAt);
    if (Number.isFinite(at) && at % HOUR_MS === 0 && at < now + SCHEDULE_DEADLINE_MIN_AHEAD_MS && deadlineEntryAcceptable(at, now, [at])) found.add(at);
  }
  return [...found].sort((a, b) => a - b);
}

/** Cette heure pile du jour est-elle acceptée à la saisie (voir {@link deadlineEntryAcceptable}) ? */
function entryAccepted(day: string, hour: number, now: number, reapply: readonly number[]): boolean {
  const at = deadlineFromEntry(day, hour);
  return at !== null && deadlineEntryAcceptable(at, now, reapply);
}

/**
 * Les heures pile d'un jour (Paris) que la saisie peut encore poser : celles
 * d'au moins 24 heures devant, plus celles des dates `reapply` (dates butoir
 * de manche reposées en masse, {@link roundScheduleDeadlines}).
 */
export function deadlineEntryHours(day: string, now: number, reapply: readonly number[] = []): number[] {
  return Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => entryAccepted(day, hour, now, reapply));
}

/**
 * Les jours proposés, **dans l'ordre** : ceux de {@link deadlineEntryDays} qui
 * ont encore une heure acceptée (aujourd'hui tard le soir n'en a plus), plus
 * le jour `keep` (celui de la date butoir en place) s'il en a une et qu'il
 * est plus loin que la liste.
 */
export function deadlineEntryChoices(now: number, keep: string | null = null, reapply: readonly number[] = []): string[] {
  const days = deadlineEntryDays(now);
  if (keep !== null && !days.includes(keep)) days.push(keep);
  return days.sort((a, b) => a.localeCompare(b)).filter((day) => deadlineEntryHours(day, now, reapply).length > 0);
}

/**
 * Où la saisie s'ouvre : la date butoir en place si elle serait encore
 * acceptée, sinon la date proposée (une date butoir passée ou à moins de 24
 * heures ne se rejoue pas telle quelle).
 */
export function deadlineEntryStart(current: number | null, suggested: number, now: number): { day: string; hour: number; fromCurrent: boolean } {
  const usable = current !== null && deadlineEntryAcceptable(current, now);
  const at = usable ? current : suggested;
  return { ...deadlineEntryOf(at), fromCurrent: usable };
}

/** Le jour et l'heure (Paris) d'un instant, pour préremplir la saisie. */
export function deadlineEntryOf(at: number): { day: string; hour: number } {
  const p = parisParts(at);
  return { day: dayKey(p.year, p.month, p.day), hour: p.hour };
}

/** L'instant d'un jour (Paris) à l'heure pile ; `null` si la saisie est illisible. */
export function deadlineFromEntry(day: string, hour: number): number | null {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!found || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return parisInstant(Number(found[1]), Number(found[2]), Number(found[3]), hour, 0);
}

const SHORT_FORMATS = new Map<Locale, Intl.DateTimeFormat>();

/** « mar. 18 nov., 21:00 » / « Tue, Nov 18, 21:00 » : une date butoir, heure de Paris (comme les avis). */
export function formatScheduleDeadline(iso: string, locale: Locale): string {
  return cached(SHORT_FORMATS, locale, (code) =>
    new Intl.DateTimeFormat(INTL_LOCALE[code], {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Europe/Paris",
    }),
  ).format(new Date(iso));
}

/**
 * La date butoir à montrer sur la pastille « à planifier » : celle à venir
 * seulement (`now` inconnu, au premier rendu : montrée). Une date passée ne
 * frappe plus ou va frapper : la pastille ne l'annonce pas.
 */
export function upcomingScheduleDeadline(deadlineAt: string | null, now: number | null): string | null {
  if (deadlineAt === null) return null;
  if (now === null) return deadlineAt;
  return new Date(deadlineAt).getTime() > now ? deadlineAt : null;
}
