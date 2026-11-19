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
 * Une entrée n'est confirmée d'office qu'une fois (`bg_planning_auto_confirms`,
 * marque posée après la confirmation) : une confirmation en échec se relance à
 * la minute suivante, une confirmation faite ne se refait pas. Un seul
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

/**
 * Les entrées à confirmer d'office maintenant : ouvertes, pas encore
 * confirmées d'office, et dont l'instant de confirmation est atteint.
 */
export function dueAutoConfirms(
  entries: readonly LoadedEntry[],
  done: ReadonlySet<string>,
  leadHours: number,
  now: number,
): LoadedEntry[] {
  return entries.filter(
    (entry) => entry.open && !done.has(entry.key) && now >= planningConfirmAt(entry.startAt, entry.deadlineAt, leadHours),
  );
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

async function confirmedKeys(executor: Executor, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const [rows] = await executor.execute<(RowDataPacket & { entry_key: string })[]>(
    `SELECT entry_key FROM bg_planning_auto_confirms WHERE entry_key IN (${keys.map(() => "?").join(", ")})`,
    [...keys],
  );
  return new Set(rows.map((row) => row.entry_key));
}

async function markConfirmed(executor: Executor, entries: readonly LoadedEntry[]): Promise<void> {
  for (const entry of entries) {
    await executor.execute(
      `INSERT IGNORE INTO bg_planning_auto_confirms (entry_key, tournament_id, match_id) VALUES (?, ?, ?)`,
      [entry.key, entry.tournamentId, entry.matchId],
    );
  }
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
      const done = await confirmedKeys(connection, open.map((entry) => entry.key));
      const due = dueAutoConfirms(open, done, durations.confirmLeadHours, now);
      let confirmed = 0;
      for (const week of groupByWeek(due)) {
        try {
          await runAutoAssign(null, { from: week.from, to: week.to }, now);
          await confirmAssignments(null, { entryKeys: week.keys }, now);
          const keys = new Set(week.keys);
          await markConfirmed(connection, due.filter((entry) => keys.has(entry.key)));
          confirmed += week.keys.length;
        } catch (error) {
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
