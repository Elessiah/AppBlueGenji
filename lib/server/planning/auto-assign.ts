/**
 * Calcul automatique du planning, par lot (`docs/features/CAST_PLANNING.md`) :
 * rassemble ce que le calcul pur (`planning-planner.ts`) attend sur une
 * fenêtre de temps, remplace les propositions **provisoires** de la fenêtre,
 * et confirme celles que le staff retient. Sous le verrou nommé du planning :
 * un geste à la fois.
 */
import type { PoolConnection } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { loadEligibleRefereeIds } from "@/lib/server/tournaments/cast-eligibility";
import { assignMatchReferee } from "@/lib/server/tournaments/match-launch";
import { loadMatchPlayerIds } from "@/lib/server/tournaments/match-players";
import { PLANNING_EVENT_REFEREES, PLANNING_ROLES, type PlanningRole } from "@/lib/shared/planning";
import {
  exclusionKey,
  planAssignments,
  type LockedAssignment,
  type PlannerInput,
} from "@/lib/shared/planning-planner";
import type { AutoAssignReport, ConfirmReport } from "@/lib/shared/planning-view";
import { loadPlanningData, loadPlanningHistory, type Executor, type LoadedEntry, type PlanningData } from "./load";
import { entryAssignments } from "./model";

/** Verrou nommé de tous les gestes d'écriture du planning (calcul, confirmation, désignation). */
export const PLANNING_LOCK = "bg_planning";
const PLANNING_LOCK_SECONDS = 10;

/** Un geste du planning sous son verrou ; `PLANNING_BUSY` si un autre le tient trop longtemps. */
export async function withPlanningLock<T>(run: (connection: PoolConnection) => Promise<T>): Promise<T> {
  try {
    return await withNamedLock(await getDatabase(), PLANNING_LOCK, PLANNING_LOCK_SECONDS, run);
  } catch (error) {
    if (error instanceof NamedLockUnavailableError) throw new Error("PLANNING_BUSY");
    throw error;
  }
}

/** Fenêtre d'un lot : les entrées qui **commencent** dans `[from, to[`. */
export type PlanningWindow = { from: number; to: number };

/**
 * Les refus du calcul : un joueur du match ne le couvre dans aucun rôle ; un
 * arbitre qui ne remplit pas la condition d'arbitrage du jeu n'arbitre pas ;
 * un membre retiré **à la main** d'un rôle d'une entrée n'y est pas replacé.
 */
export async function loadExclusions(
  executor: Executor,
  data: PlanningData,
  entries: readonly LoadedEntry[],
): Promise<Set<string>> {
  const excluded = new Set<string>();
  await excludeMatchPlayers(executor, entries, excluded);
  await excludeIneligibleReferees(executor, data, entries, excluded);
  for (const removal of data.removals) excluded.add(exclusionKey(removal.entryKey, removal.userId, removal.role));
  return excluded;
}

async function excludeMatchPlayers(executor: Executor, entries: readonly LoadedEntry[], excluded: Set<string>): Promise<void> {
  for (const entry of entries) {
    if (entry.matchId === null) continue;
    const players = await loadMatchPlayerIds(executor, {
      team1_id: entry.team1?.teamId ?? null,
      team2_id: entry.team2?.teamId ?? null,
    });
    for (const userId of players) {
      for (const role of PLANNING_ROLES) excluded.add(exclusionKey(entry.key, userId, role));
    }
  }
}

async function excludeIneligibleReferees(
  executor: Executor,
  data: PlanningData,
  entries: readonly LoadedEntry[],
  excluded: Set<string>,
): Promise<void> {
  const referees = data.members.filter((member) => member.roles.includes("REFEREE")).map((member) => member.userId);
  for (const game of ["OW", "MR"] as const) {
    const ofGame = entries.filter((entry) => entry.game === game);
    if (ofGame.length === 0 || referees.length === 0) continue;
    const eligible = await loadEligibleRefereeIds(executor, referees, game);
    for (const userId of referees.filter((id) => !eligible.has(id))) {
      for (const entry of ofGame) excluded.add(exclusionKey(entry.key, userId, "REFEREE"));
    }
  }
}

/** Le lot du calcul : entrées ouvertes qui commencent dans la fenêtre. */
export function batchEntries(data: Pick<PlanningData, "entries">, window: PlanningWindow): LoadedEntry[] {
  return data.entries.filter((entry) => entry.open && entry.startAt >= window.from && entry.startAt < window.to);
}

/**
 * L'entrée du calcul. Verrouillé (contrainte du lot) : choix du staff,
 * propositions confirmées, casters inscrits sur le match, arbitre désigné du
 * match, et propositions provisoires **hors** du lot. Les propositions
 * provisoires du lot sont remises en jeu : le calcul les refait toutes.
 */
export function preparePlanner(
  data: PlanningData,
  batch: readonly LoadedEntry[],
  history: ReadonlyMap<number, number>,
  excluded: ReadonlySet<string>,
): PlannerInput {
  const inBatch = new Set(batch.map((entry) => entry.key));
  const locked: LockedAssignment[] = [];
  for (const entry of data.entries) {
    for (const row of entryAssignments(entry, data)) {
      if (row.provisional && inBatch.has(entry.key)) continue;
      locked.push({ entryKey: entry.key, userId: row.userId, role: row.role, reason: row.reason });
    }
  }
  return {
    entries: data.entries.map((entry) => ({
      key: entry.key,
      startAt: entry.startAt,
      endAt: entry.endAt,
      open: inBatch.has(entry.key),
      refereeSlots: entry.kind === "TOURNAMENT" ? PLANNING_EVENT_REFEREES : 1,
    })),
    availability: data.availability,
    members: new Map(data.members.map((member) => [member.userId, member.roles])),
    soloCasterIds: new Set(data.members.filter((member) => member.soloCaster).map((member) => member.userId)),
    locked,
    refereeDecided: new Set(data.entries.filter((entry) => entry.selfManaged).map((entry) => entry.key)),
    history,
    excluded,
  };
}

export async function writeEvent(
  executor: Executor,
  entry: LoadedEntry,
  userId: number,
  role: PlanningRole,
  kind: "ASSIGNED" | "CONFIRMED" | "REMOVED",
  source: "AUTO" | "MANUAL",
  actorId: number,
): Promise<void> {
  await executor.execute(
    `INSERT INTO bg_planning_events (entry_key, user_id, role, tournament_id, match_id, kind, source, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.key, userId, role, entry.tournamentId, entry.matchId, kind, source, actorId],
  );
}

/** Pose une ligne d'attribution (un choix du staff naît confirmé) et l'évènement qui la retrace. */
export async function writeAssignment(
  executor: Executor,
  entry: LoadedEntry,
  row: { userId: number; role: PlanningRole; source: "AUTO" | "MANUAL"; reason: "PREFERENCE" | "LOAD" | "MANUAL" },
  actorId: number,
): Promise<void> {
  const confirmed = row.source === "MANUAL" ? 1 : 0;
  await executor.execute(
    `INSERT INTO bg_planning_assignments
       (entry_key, user_id, role, tournament_id, match_id, source, reason, confirmed, assigned_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE source = VALUES(source), reason = VALUES(reason), confirmed = VALUES(confirmed),
                             assigned_by_user_id = VALUES(assigned_by_user_id)`,
    [entry.key, row.userId, row.role, entry.tournamentId, entry.matchId, row.source, row.reason, confirmed, actorId],
  );
  await writeEvent(executor, entry, row.userId, row.role, "ASSIGNED", row.source, actorId);
}

function affected(result: unknown): number {
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

/**
 * Lance un lot : les propositions provisoires des entrées ouvertes de la
 * fenêtre sont effacées, puis recalculées ensemble autour de tout ce qui est
 * verrouillé. Relancer le même lot sur les mêmes données rend le même
 * planning (calcul déterministe).
 */
export async function runAutoAssign(
  actorId: number,
  window: PlanningWindow,
  now: number = Date.now(),
): Promise<AutoAssignReport> {
  return withPlanningLock(async (connection) => {
    const data = await loadPlanningData(connection, { now, includeHidden: true });
    const batch = batchEntries(data, window);
    if (batch.length === 0) return { entries: 0, proposed: 0, replaced: 0 };
    const history = await loadPlanningHistory(connection, now);
    const excluded = await loadExclusions(connection, data, batch);
    const input = preparePlanner(data, batch, history, excluded);
    const keys = batch.map((entry) => entry.key);
    const [cleared] = await connection.execute(
      `DELETE FROM bg_planning_assignments
        WHERE source = 'AUTO' AND confirmed = 0 AND entry_key IN (${keys.map(() => "?").join(", ")})`,
      keys,
    );
    const byKey = new Map(batch.map((entry) => [entry.key, entry]));
    let proposed = 0;
    for (const planned of planAssignments(input)) {
      const entry = byKey.get(planned.entryKey);
      if (!entry) continue;
      await writeAssignment(connection, entry, { userId: planned.userId, role: planned.role, reason: planned.reason, source: "AUTO" }, actorId);
      proposed += 1;
    }
    return { entries: batch.length, proposed, replaced: affected(cleared) };
  });
}

/** Ce qu'un geste de confirmation retient : des entrées nommées, et/ou celles qui commencent avant `until`. */
export type ConfirmScope = { entryKeys?: readonly string[]; until?: number };

export function entriesToConfirm(data: Pick<PlanningData, "entries">, scope: ConfirmScope): LoadedEntry[] {
  const wanted = new Set(scope.entryKeys ?? []);
  return data.entries.filter(
    (entry) => entry.open && (wanted.has(entry.key) || (scope.until !== undefined && entry.startAt < scope.until)),
  );
}

/**
 * Confirme des propositions provisoires. Les autres restent provisoires, et
 * les lots suivants se calculent **autour** des confirmées. Un arbitre de
 * match est alors posé sur le match (`assignMatchReferee`, sans rien
 * remplacer) ; un refus du match (arbitre posé entre-temps, condition
 * d'arbitrage, joueur du match) retire la proposition.
 */
export async function confirmAssignments(
  actorId: number,
  scope: ConfirmScope,
  now: number = Date.now(),
): Promise<ConfirmReport> {
  return withPlanningLock(async (connection) => {
    const data = await loadPlanningData(connection, { now, includeHidden: true });
    let confirmed = 0;
    let refused = 0;
    for (const entry of entriesToConfirm(data, scope)) {
      for (const row of entryAssignments(entry, data).filter((candidate) => candidate.provisional)) {
        if (entry.kind === "MATCH" && row.role === "REFEREE" && entry.matchId !== null) {
          try {
            await assignMatchReferee(entry.matchId, actorId, row.userId, null);
          } catch {
            await connection.execute(
              "DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = 'REFEREE' AND confirmed = 0",
              [entry.key, row.userId],
            );
            await writeEvent(connection, entry, row.userId, row.role, "REMOVED", "AUTO", actorId);
            refused += 1;
            continue;
          }
        }
        await connection.execute(
          "UPDATE bg_planning_assignments SET confirmed = 1 WHERE entry_key = ? AND user_id = ? AND role = ?",
          [entry.key, row.userId, row.role],
        );
        await writeEvent(connection, entry, row.userId, row.role, "CONFIRMED", "AUTO", actorId);
        confirmed += 1;
      }
    }
    return { confirmed, refused };
  });
}
