/**
 * Confirmation d'office du planning (`docs/features/SCHEDULE_DEADLINE.md`
 * § Planning, `CAST_PLANNING.md`).
 *
 * Chaque entrée ouverte se confirme d'office à `min(date butoir, début −
 * délai)` (`planningConfirmAt`, délai réglé par le staff, 24 h au moins). Les
 * entrées échues sont regroupées par semaine du planning : pour chaque semaine,
 * l'affectation automatique **refait** d'abord ses propositions provisoires
 * autour de ce qui est déjà confirmé (`runAutoAssign`), puis les entrées échues
 * — et elles seules — sont confirmées (`confirmAssignments`) ; les affectés en
 * sont prévenus (`PLANNING_ASSIGNED`). Un match programmé tôt part ainsi dans
 * un petit lot à lui ; les matchs programmés plus tard se répartissent ensuite
 * autour des confirmés.
 *
 * Une entrée n'est confirmée d'office qu'une fois **par horaire**
 * (`bg_planning_auto_confirms`, marque posée après la confirmation avec le
 * début confirmé) : reprogrammée, elle se confirme de nouveau. La marque
 * compte aussi, par rôle, les propositions provisoires lues juste **avant**
 * la confirmation (`pending_roles`, celles qu'elle n'a pas pu confirmer y
 * restent) : une proposition de plus par la suite (un caster libéré, un
 * nouveau calcul, même entre la confirmation et la marque) rouvre l'entrée au
 * passage suivant, alors qu'un reste recréé à l'identique par un nouveau
 * calcul ne la rouvre pas. Une semaine en échec attend
 * {@link FAILED_WEEK_RETRY_MS} avant d'être relancée. Un seul
 * processus à la fois (verrou nommé `bg_planning_confirms`, pris sans
 * attendre) ; les écritures du planning prennent en plus le verrou du planning
 * (`bg_planning`, `withPlanningLock`).
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { planningNextWeekStart, planningWeekStart } from "@/lib/shared/planning";
import { planningConfirmAt } from "@/lib/shared/schedule-deadline";
import { confirmAssignments, runAutoAssign } from "./auto-assign";
import { loadDurationSettings, loadPlanningEntries, type Executor, type LoadedEntry } from "./load";

/** Verrou nommé du balayage des confirmations d'office. */
export const AUTO_CONFIRM_LOCK = "bg_planning_confirms";
const SWEEP_TICK_MS = 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;
/** Une semaine dont la confirmation a échoué est relancée au plus toutes les dix minutes. */
export const FAILED_WEEK_RETRY_MS = 10 * 60 * 1000;

/**
 * Marques des confirmations d'office : entrée → début confirmé (`null` : marque
 * d'avant la colonne), et entrées marquées qui portent plus de propositions
 * provisoires qu'à leur marque (`reopenedEntries`).
 */
export type AutoConfirmMarks = { startAt: ReadonlyMap<string, number | null>; reopened: ReadonlySet<string> };

/**
 * Les entrées à confirmer d'office maintenant : ouvertes, dont l'instant de
 * confirmation est atteint, et pas encore confirmées d'office **pour ce début**
 * — ou confirmées, mais avec une proposition provisoire arrivée depuis.
 */
export function dueAutoConfirms(
  entries: readonly LoadedEntry[],
  marks: AutoConfirmMarks,
  leadHours: number,
  now: number,
): LoadedEntry[] {
  return entries.filter((entry) => {
    if (!entry.open || now < planningConfirmAt(entry.startAt, entry.deadlineAt, leadHours)) return false;
    const marked = marks.startAt.get(entry.key);
    if (marked === undefined) return true;
    return marked !== entry.startAt || marks.reopened.has(entry.key);
  });
}

/** Les entrées échues, par semaine du planning (lundi 00:00, heure de Paris), dans l'ordre. */
export function groupByWeek(entries: readonly LoadedEntry[]): { from: number; to: number; keys: string[] }[] {
  const weeks = new Map<number, string[]>();
  for (const entry of entries) {
    const week = planningWeekStart(entry.startAt);
    const keys = weeks.get(week) ?? [];
    keys.push(entry.key);
    weeks.set(week, keys);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([from, keys]) => ({ from, to: planningNextWeekStart(from), keys }));
}

/** Propositions provisoires d'une entrée, comptées par rôle. */
export type PendingRoles = Readonly<Record<string, number>>;

/** Lit `pending_roles` (illisible ou absent : aucune). */
export function parsePendingRoles(raw: string | null): PendingRoles {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const counts: Record<string, number> = {};
    for (const [role, count] of Object.entries(parsed)) {
      if (typeof count === "number" && Number.isInteger(count) && count > 0) counts[role] = count;
    }
    return counts;
  } catch {
    return {};
  }
}

/** Les entrées marquées qui portent, pour un rôle, plus de propositions provisoires qu'à leur marque. */
export function reopenedEntries(
  stored: ReadonlyMap<string, PendingRoles>,
  current: ReadonlyMap<string, PendingRoles>,
): Set<string> {
  const reopened = new Set<string>();
  for (const [key, counts] of current) {
    const before = stored.get(key);
    if (before === undefined) continue;
    if (Object.entries(counts).some(([role, count]) => count > (before[role] ?? 0))) reopened.add(key);
  }
  return reopened;
}

/** Propositions provisoires des entrées, comptées par rôle. */
async function readPendingRoles(executor: Executor, keys: readonly string[]): Promise<Map<string, PendingRoles>> {
  const pending = new Map<string, Record<string, number>>();
  if (keys.length === 0) return pending;
  const [rows] = await executor.execute<(RowDataPacket & { entry_key: string; role: string; n: number | string })[]>(
    `SELECT entry_key, role, COUNT(*) AS n FROM bg_planning_assignments
      WHERE confirmed = 0 AND entry_key IN (${keys.map(() => "?").join(", ")})
      GROUP BY entry_key, role`,
    [...keys],
  );
  for (const row of rows) {
    const counts = pending.get(row.entry_key) ?? {};
    counts[row.role] = Number(row.n);
    pending.set(row.entry_key, counts);
  }
  return pending;
}

async function readMarks(executor: Executor, keys: readonly string[]): Promise<AutoConfirmMarks> {
  if (keys.length === 0) return { startAt: new Map(), reopened: new Set() };
  const list = keys.map(() => "?").join(", ");
  const [rows] = await executor.execute<
    (RowDataPacket & { entry_key: string; start_at: Date | string | null; pending_roles: string | null })[]
  >(`SELECT entry_key, start_at, pending_roles FROM bg_planning_auto_confirms WHERE entry_key IN (${list})`, [...keys]);
  const startAt = new Map(rows.map((row) => [row.entry_key, row.start_at === null ? null : new Date(row.start_at).getTime()]));
  if (startAt.size === 0) return { startAt, reopened: new Set() };
  const stored = new Map(rows.map((row) => [row.entry_key, parsePendingRoles(row.pending_roles)]));
  return { startAt, reopened: reopenedEntries(stored, await readPendingRoles(executor, [...startAt.keys()])) };
}

async function markConfirmed(
  executor: Executor,
  entries: readonly LoadedEntry[],
  pending: ReadonlyMap<string, PendingRoles>,
): Promise<void> {
  for (const entry of entries) {
    const counts = JSON.stringify(pending.get(entry.key) ?? {});
    await executor.execute(
      `INSERT INTO bg_planning_auto_confirms (entry_key, tournament_id, match_id, start_at, pending_roles) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_at = VALUES(start_at), pending_roles = VALUES(pending_roles), confirmed_at = CURRENT_TIMESTAMP`,
      [entry.key, entry.tournamentId, entry.matchId, new Date(entry.startAt), counts],
    );
  }
}

const globalRetry = globalThis as typeof globalThis & { __bgPlanningAutoConfirmRetry?: Map<number, number> };

/** Semaine (début) → instant avant lequel elle n'est pas relancée, pour ce processus. */
function retryAfter(): Map<number, number> {
  globalRetry.__bgPlanningAutoConfirmRetry ??= new Map();
  return globalRetry.__bgPlanningAutoConfirmRetry;
}

/**
 * Un passage : rend le nombre d'entrées confirmées d'office. Une semaine en
 * échec (planning occupé, panne) n'est pas marquée : elle se relance au
 * passage suivant, les autres semaines continuent.
 */
export async function sweepAutoConfirms(now: number = Date.now()): Promise<number> {
  const db = await getDatabase();
  try {
    return await withNamedLock(db, AUTO_CONFIRM_LOCK, 0, async (connection) => {
      const durations = await loadDurationSettings(connection);
      const entries = await loadPlanningEntries(connection, { now, includeHidden: true, durations });
      const open = entries.filter((entry) => entry.open);
      const marks = await readMarks(connection, open.map((entry) => entry.key));
      const due = dueAutoConfirms(open, marks, durations.confirmLeadHours, now);
      let confirmed = 0;
      for (const week of groupByWeek(due)) {
        if ((retryAfter().get(week.from) ?? 0) > now) continue;
        try {
          await runAutoAssign(null, { from: week.from, to: week.to }, now);
          // Lues **avant** la confirmation : ce qu'elle laisse provisoire y reste
          // compté ; une proposition arrivée ensuite rouvrira l'entrée.
          const attempted = await readPendingRoles(connection, week.keys);
          await confirmAssignments(null, { entryKeys: week.keys }, now);
          const keys = new Set(week.keys);
          await markConfirmed(connection, due.filter((entry) => keys.has(entry.key)), attempted);
          confirmed += week.keys.length;
          retryAfter().delete(week.from);
        } catch (error) {
          retryAfter().set(week.from, now + FAILED_WEEK_RETRY_MS);
          console.error("[planning] confirmation d'office en échec, reprise au prochain passage", failureReason(error));
        }
      }
      return confirmed;
    });
  } catch (error) {
    if (error instanceof NamedLockUnavailableError) return 0;
    throw error;
  }
}

type ClockState = { timer: ReturnType<typeof setInterval> | null; failing: boolean; running: boolean };
const globalClock = globalThis as typeof globalThis & { __bgPlanningAutoConfirm?: ClockState };

async function sweepOnce(state: ClockState): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    await sweepAutoConfirms();
    state.failing = false;
  } catch (error) {
    if (!state.failing) console.error("[planning] Balayage des confirmations d'office impossible.", failureReason(error));
    state.failing = true;
  } finally {
    state.running = false;
  }
}

/** Lance le balayage des confirmations d'office (une fois par processus). */
export function startPlanningAutoConfirmClock(): void {
  const state = (globalClock.__bgPlanningAutoConfirm ??= { timer: null, failing: false, running: false });
  if (state.timer) return;
  const first = setTimeout(() => void sweepOnce(state), FIRST_SWEEP_DELAY_MS);
  first.unref?.();
  state.timer = setInterval(() => void sweepOnce(state), SWEEP_TICK_MS);
  state.timer.unref?.();
}
