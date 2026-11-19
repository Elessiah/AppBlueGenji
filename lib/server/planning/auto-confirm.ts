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
 * compte aussi, par rôle, les propositions provisoires que la confirmation
 * **n'a pas pu** confirmer (`pending_roles` : lues avant elle, encore
 * provisoires après — `leftoverRoles`) : une proposition de plus par la suite
 * (un caster libéré, un nouveau calcul, même entre la confirmation et la
 * marque) rouvre l'entrée au passage suivant, alors qu'un reste recréé à
 * l'identique par un nouveau calcul ne la rouvre pas. Une semaine en échec attend
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
    return markDue(entry.startAt, marks.startAt.get(entry.key), marks.reopened.has(entry.key));
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

/**
 * Règle unique, lue par le balayage (`reopenedEntries`) comme par la carte
 * (`autoConfirmAwaiting`) : pour un rôle, plus de propositions provisoires
 * qu'à la marque.
 */
export function exceedsMark(current: PendingRoles, atMark: PendingRoles): boolean {
  return Object.entries(current).some(([role, count]) => count > (atMark[role] ?? 0));
}

/** Les entrées marquées qui portent, pour un rôle, plus de propositions provisoires qu'à leur marque. */
export function reopenedEntries(
  stored: ReadonlyMap<string, PendingRoles>,
  current: ReadonlyMap<string, PendingRoles>,
): Set<string> {
  const reopened = new Set<string>();
  for (const [key, counts] of current) {
    const before = stored.get(key);
    if (before !== undefined && exceedsMark(counts, before)) reopened.add(key);
  }
  return reopened;
}

/** Une proposition provisoire : entrée, compte, rôle. */
export type PendingProposal = { entryKey: string; userId: number; role: string };

/** Compte par entrée et par rôle. */
export function countPendingRoles(proposals: readonly PendingProposal[]): Map<string, PendingRoles> {
  const pending = new Map<string, Record<string, number>>();
  for (const proposal of proposals) {
    const counts = pending.get(proposal.entryKey) ?? {};
    counts[proposal.role] = (counts[proposal.role] ?? 0) + 1;
    pending.set(proposal.entryKey, counts);
  }
  return pending;
}

/**
 * Ce que la confirmation n'a pas pu confirmer : les propositions lues avant
 * elle et encore provisoires après. Une proposition arrivée entre-temps n'y
 * compte pas (elle rouvrira l'entrée), une proposition confirmée non plus.
 */
export function leftoverRoles(
  before: readonly PendingProposal[],
  after: readonly PendingProposal[],
): Map<string, PendingRoles> {
  const id = (proposal: PendingProposal) => `${proposal.entryKey}|${proposal.userId}|${proposal.role}`;
  const earlier = new Set(before.map(id));
  return countPendingRoles(after.filter((proposal) => earlier.has(id(proposal))));
}

/** Propositions provisoires des entrées. */
async function readPendingProposals(executor: Executor, keys: readonly string[]): Promise<PendingProposal[]> {
  const proposals: PendingProposal[] = [];
  for (const chunk of keyChunks(keys)) {
    const [rows] = await executor.execute<(RowDataPacket & { entry_key: string; user_id: number | string; role: string })[]>(
      `SELECT entry_key, user_id, role FROM bg_planning_assignments
        WHERE confirmed = 0 AND entry_key IN (${chunk.map(() => "?").join(", ")})`,
      chunk,
    );
    for (const row of rows) proposals.push({ entryKey: row.entry_key, userId: Number(row.user_id), role: row.role });
  }
  return proposals;
}

/** Propositions provisoires des entrées, comptées par rôle. */
async function readPendingRoles(executor: Executor, keys: readonly string[]): Promise<Map<string, PendingRoles>> {
  return countPendingRoles(await readPendingProposals(executor, keys));
}

/** Clés par instruction `IN` (liste bornée, comme les paquets de l'écriture des dates butoir). */
export const KEY_CHUNK = 500;

/** Découpe `keys` en paquets de {@link KEY_CHUNK} (pur). */
export function keyChunks<T>(keys: readonly T[], size: number = KEY_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let from = 0; from < keys.length; from += size) chunks.push(keys.slice(from, from + size));
  return chunks;
}

/** Une marque lue : début confirmé et restes comptés à la marque. */
export type StoredAutoConfirm = { startAt: number | null; pending: PendingRoles };

/** Lit les marques des entrées. */
export async function readStoredAutoConfirms(executor: Executor, keys: readonly string[]): Promise<Map<string, StoredAutoConfirm>> {
  const stored = new Map<string, StoredAutoConfirm>();
  for (const chunk of keyChunks(keys)) {
    const [rows] = await executor.execute<
      (RowDataPacket & { entry_key: string; start_at: Date | string | null; pending_roles: string | null })[]
    >(`SELECT entry_key, start_at, pending_roles FROM bg_planning_auto_confirms WHERE entry_key IN (${chunk.map(() => "?").join(", ")})`, chunk);
    for (const row of rows) {
      stored.set(row.entry_key, {
        startAt: row.start_at === null ? null : new Date(row.start_at).getTime(),
        pending: parsePendingRoles(row.pending_roles),
      });
    }
  }
  return stored;
}

/**
 * Une confirmation d'office reste à faire pour l'entrée : des propositions
 * provisoires, et pas de marque pour ce début, ou plus de propositions
 * qu'à la marque (le passage suivant la reprendra). Un reste que la
 * confirmation n'a pas pu confirmer n'est **pas** en attente : rien ne le
 * reprendra, le staff le confirme à la main.
 */
export function autoConfirmAwaiting(startAt: number, current: PendingRoles, mark: StoredAutoConfirm | undefined): boolean {
  if (Object.keys(current).length === 0) return false;
  return markDue(startAt, mark?.startAt, exceedsMark(current, mark?.pending ?? {}));
}

/**
 * Règle unique de `dueAutoConfirms` et `autoConfirmAwaiting` : pas de marque,
 * une marque d'un autre début, ou une entrée rouverte depuis la marque.
 */
function markDue(startAt: number, markedStart: number | null | undefined, reopened: boolean): boolean {
  return markedStart === undefined || markedStart !== startAt || reopened;
}

/** Propositions provisoires (`confirmed` faux) des affectations chargées, comptées par entrée et par rôle. */
export function loadedPendingRoles(
  assignments: readonly { entryKey: string; userId: number; role: string; confirmed: boolean }[],
): Map<string, PendingRoles> {
  return countPendingRoles(assignments.filter((row) => !row.confirmed));
}

async function readMarks(executor: Executor, keys: readonly string[]): Promise<AutoConfirmMarks> {
  const marks = await readStoredAutoConfirms(executor, keys);
  const startAt = new Map([...marks].map(([key, mark]) => [key, mark.startAt]));
  if (startAt.size === 0) return { startAt, reopened: new Set() };
  const stored = new Map([...marks].map(([key, mark]) => [key, mark.pending]));
  return { startAt, reopened: reopenedEntries(stored, await readPendingRoles(executor, [...startAt.keys()])) };
}

/** Marques écrites par instruction. */
export const MARK_CHUNK = 100;

async function markConfirmed(
  executor: Executor,
  entries: readonly LoadedEntry[],
  pending: ReadonlyMap<string, PendingRoles>,
): Promise<void> {
  // Une instruction par paquet (et non une par entrée).
  for (const chunk of keyChunks(entries, MARK_CHUNK)) {
    await executor.execute(
      `INSERT INTO bg_planning_auto_confirms (entry_key, tournament_id, match_id, start_at, pending_roles) VALUES ${chunk
        .map(() => "(?, ?, ?, ?, ?)")
        .join(", ")}
       ON DUPLICATE KEY UPDATE start_at = VALUES(start_at), pending_roles = VALUES(pending_roles), confirmed_at = CURRENT_TIMESTAMP`,
      chunk.flatMap((entry) => [
        entry.key,
        entry.tournamentId,
        entry.matchId,
        new Date(entry.startAt),
        JSON.stringify(pending.get(entry.key) ?? {}),
      ]),
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
      // L'instant de confirmation se juge sur les entrées seules : marques et propositions ne se lisent
      // que pour celles qui y sont arrivées (le plus souvent aucune), jamais pour tout l'horizon.
      const reached = entries.filter((entry) => entry.open && now >= planningConfirmAt(entry.startAt, entry.deadlineAt, durations.confirmLeadHours));
      if (reached.length === 0) return 0;
      const marks = await readMarks(connection, reached.map((entry) => entry.key));
      const due = dueAutoConfirms(reached, marks, durations.confirmLeadHours, now);
      let confirmed = 0;
      for (const week of groupByWeek(due)) {
        if ((retryAfter().get(week.from) ?? 0) > now) continue;
        try {
          await runAutoAssign(null, { from: week.from, to: week.to }, now);
          // Lues avant et après la confirmation : seul ce qu'elle n'a pas pu confirmer
          // est compté ; une proposition arrivée entre-temps ou ensuite rouvrira l'entrée.
          const before = await readPendingProposals(connection, week.keys);
          await confirmAssignments(null, { entryKeys: week.keys }, now);
          const leftover = leftoverRoles(before, await readPendingProposals(connection, week.keys));
          const keys = new Set(week.keys);
          await markConfirmed(connection, due.filter((entry) => keys.has(entry.key)), leftover);
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
