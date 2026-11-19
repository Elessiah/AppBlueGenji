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
/** Une date butoir se pose au moins une heure devant (le temps d'en prévenir les engagées). */
export const SCHEDULE_DEADLINE_MIN_AHEAD_MS = HOUR_MS;
/**
 * Préavis minimal d'une paire : une date butoir ne frappe que si son premier
 * avis est parti au moins trente minutes avant elle (`deadlineArmed`) — la
 * moitié du préavis minimal de la pose, pour laisser au balayage le temps
 * d'annoncer une date butoir posée une heure devant.
 */
export const SCHEDULE_DEADLINE_ARM_MIN_MS = 30 * MINUTE_MS;
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
 * `now`. Arrondie à la minute : la colonne `DATETIME` n'a pas de fractions, et
 * l'horaire annoncé doit être celui que la base garde.
 */
export function readScheduleDeadline(raw: unknown, now: number): ScheduleDeadlineInput {
  if (raw === null) return { kind: "clear" };
  if (typeof raw !== "string" || raw.length > 40) return { kind: "invalid", code: "INVALID_SCHEDULE_DEADLINE" };
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return { kind: "invalid", code: "INVALID_SCHEDULE_DEADLINE" };
  const at = parsed - (((parsed % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);
  if (at < now + SCHEDULE_DEADLINE_MIN_AHEAD_MS) return { kind: "invalid", code: "SCHEDULE_DEADLINE_TOO_SOON" };
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

/** Ce que fait le balayage d'une date butoir échue : double forfait, ou elle s'éteint. */
export type DeadlineOutcome = "FORFEIT" | "LAPSE" | null;

/**
 * L'issue d'une date butoir (`null` : pas encore échue, ou le match est joué).
 *
 * - toujours **à planifier** (deux engagées connues, ni date ni lancement,
 *   option allumée) → **double forfait** ;
 * - sans horaire mais une engagée manquante, option éteinte, ou match déjà
 *   programmé ou lancé → la date butoir **s'éteint** (effacée) : rien à
 *   forfaiter, et elle ne doit pas frapper plus tard un match qui repasserait
 *   à planifier (horaire retiré, lancement défait) sans que personne l'ait vu
 *   venir.
 */
export function deadlineOutcome(match: DeadlineMatch, deadlineAt: number | null, now: number): DeadlineOutcome {
  if (deadlineAt === null || deadlineAt > now) return null;
  if (match.status === "COMPLETED" || match.status === "AWAITING_CONFIRMATION") return null;
  if (match.startAt !== null || match.launchedAt !== null) return "LAPSE";
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
export type OpenedAtMatch = { status: string; updatedAt: string };

/** Une ouverture plus ancienne que ce délai n'est plus celle de la manche en cours. */
export const SCHEDULE_OPENED_LOOKBACK_MS = 7 * DAY_MS;

/**
 * Quand la planification s'est ouverte : la fin du dernier match joué du
 * tournoi (dimanche 23:00 pour une manche finie dimanche soir), sinon `now`
 * (rien de joué depuis une semaine, ou horloge incohérente).
 */
export function scheduleOpenedAt(matches: readonly OpenedAtMatch[], now: number): number {
  let latest: number | null = null;
  for (const match of matches) {
    if (match.status !== "COMPLETED") continue;
    const at = Date.parse(match.updatedAt);
    if (!Number.isFinite(at) || at > now || at < now - SCHEDULE_OPENED_LOOKBACK_MS) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest ?? now;
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
