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
import { transact } from "@/lib/server/tournaments/transaction";
import type { RefereeIneligibility } from "@/lib/shared/match-referee";
import { PLANNING_EVENT_REFEREES, PLANNING_ROLES, planningWeekStart, type PlanningRole } from "@/lib/shared/planning";
import {
  exclusionKey,
  planAssignments,
  slotsOverlap,
  type LockedAssignment,
  type PlannerInput,
} from "@/lib/shared/planning-planner";
import type { AutoAssignReport, ConfirmReport } from "@/lib/shared/planning-view";
import { loadPlanningData, loadPlanningHistory, type Executor, type LoadedEntry, type PlanningData } from "./load";
import { entryAssignments } from "./model";
import { loadEntryPlayers, playersDuring } from "./players";

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
 * Les refus du calcul : qui joue pendant une entrée — dans ce match, dans le
 * tournoi entier d'une entrée « tournoi », ou dans une entrée qui la
 * chevauche — ne la couvre dans aucun rôle ; un arbitre qui ne remplit pas la
 * condition d'arbitrage du jeu n'arbitre pas ; un membre retiré **à la main**
 * d'un rôle d'une entrée n'y est pas replacé.
 */
export async function loadExclusions(
  executor: Executor,
  data: PlanningData,
  entries: readonly LoadedEntry[],
): Promise<Set<string>> {
  const excluded = new Set<string>();
  await excludePlayers(executor, data, entries, excluded);
  await excludeIneligibleReferees(executor, data, entries, excluded);
  for (const removal of data.removals) excluded.add(exclusionKey(removal.entryKey, removal.userId, removal.role));
  return excluded;
}

async function excludePlayers(
  executor: Executor,
  data: PlanningData,
  entries: readonly LoadedEntry[],
  excluded: Set<string>,
): Promise<void> {
  // Seules comptent les entrées du lot et celles qui en chevauchent une.
  const around = data.entries.filter((other) => entries.some((entry) => other.key === entry.key || slotsOverlap(other, entry)));
  const players = await loadEntryPlayers(executor, around);
  for (const entry of entries) {
    for (const userId of playersDuring(entry, around, players)) {
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
  historyWeek?: number,
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
    historyWeek,
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
 * planning (calcul déterministe). L'équité se lit jusqu'à la semaine **du
 * lot** (`loadPlanningHistory`), pas jusqu'à celle d'aujourd'hui. Le calcul
 * se fait d'abord ; l'effacement et les nouvelles propositions s'écrivent
 * ensuite d'un bloc (une transaction) : un échec en route ne laisse pas un
 * lot à moitié effacé.
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
    const anchor = Math.max(now, window.from);
    const history = await loadPlanningHistory(connection, anchor);
    const excluded = await loadExclusions(connection, data, batch);
    const planned = planAssignments(preparePlanner(data, batch, history, excluded, planningWeekStart(anchor)));
    const keys = batch.map((entry) => entry.key);
    const byKey = new Map(batch.map((entry) => [entry.key, entry]));
    return transact(connection, async () => {
      await confirmPendingReferees(connection, data, actorId);
      const [cleared] = await connection.execute(
        `DELETE FROM bg_planning_assignments
          WHERE source = 'AUTO' AND confirmed = 0 AND entry_key IN (${keys.map(() => "?").join(", ")})`,
        keys,
      );
      let proposed = 0;
      for (const row of planned) {
        const entry = byKey.get(row.entryKey);
        if (!entry) continue;
        await writeAssignment(connection, entry, { userId: row.userId, role: row.role, reason: row.reason, source: "AUTO" }, actorId);
        proposed += 1;
      }
      return { entries: batch.length, proposed, replaced: affected(cleared) };
    });
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
 * Refus **métier** de la désignation d'un arbitre de match
 * (`assignMatchReferee`) : la proposition ne peut pas tenir, elle est
 * retirée. Toute autre erreur (base, interblocage) est une panne : le geste
 * échoue et se relance, sans rien retirer.
 */
type MatchRefereeRefusal =
  | Exclude<RefereeIneligibility, "ACCOUNT_GONE">
  | "MATCH_NOT_FOUND"
  | "MATCH_ALREADY_COMPLETED"
  | "MATCH_NOT_LAUNCHABLE"
  | "REFEREE_CHANGED";

// La liste unique, que la route des gestes reprend (`PLANNING_STATUSES`). Un
// motif d'inéligibilité ajouté (`RefereeIneligibility`) sans entrée ici ne
// compile pas (`satisfies`) : il ne passerait pas pour une panne.
const MATCH_REFEREE_REFUSAL_SET = {
  MATCH_NOT_FOUND: true,
  MATCH_ALREADY_COMPLETED: true,
  MATCH_NOT_LAUNCHABLE: true,
  NOT_REFEREE: true,
  REFEREE_IDENTITY_REQUIRED: true,
  REFEREE_DISCORD_REQUIRED: true,
  REFEREE_OBJECTION: true,
  REFEREE_IS_PLAYER: true,
  REFEREE_CHANGED: true,
} satisfies Record<MatchRefereeRefusal, true>;

export const MATCH_REFEREE_REFUSAL_CODES = Object.keys(MATCH_REFEREE_REFUSAL_SET) as readonly MatchRefereeRefusal[];

export const MATCH_REFEREE_REFUSALS: ReadonlySet<string> = new Set(MATCH_REFEREE_REFUSAL_CODES);

export function isMatchRefereeRefusal(error: unknown): boolean {
  return error instanceof Error && MATCH_REFEREE_REFUSALS.has(error.message);
}

/**
 * Une proposition à confirmer, et ce qu'il en advient : `refused` (le match
 * l'a refusée), `settled` (arbitre de match dont le match a décidé : posé ou
 * refusé).
 */
type ConfirmStep = { entry: LoadedEntry; userId: number; role: PlanningRole; refused: boolean; settled: boolean };

function confirmSteps(data: PlanningData, scope: ConfirmScope): ConfirmStep[] {
  const steps: ConfirmStep[] = [];
  for (const entry of entriesToConfirm(data, scope)) {
    for (const row of entryAssignments(entry, data).filter((candidate) => candidate.provisional)) {
      steps.push({ entry, userId: row.userId, role: row.role, refused: false, settled: false });
    }
  }
  return steps;
}

/**
 * Propositions d'arbitre restées provisoires alors que le match a déjà cet
 * arbitre — une confirmation interrompue par une panne après la désignation
 * du match : elles se confirment sans rien redemander au match, que l'entrée
 * soit encore ouverte ou déjà commencée. Jouée au début de chaque calcul et
 * de chaque confirmation (dans leur transaction) : un calcul relancé ne les
 * efface donc jamais comme de simples propositions.
 */
export async function confirmPendingReferees(executor: Executor, data: PlanningData, actorId: number): Promise<number> {
  let confirmed = 0;
  for (const entry of data.entries) {
    if (entry.kind !== "MATCH" || entry.matchRefereeId === null) continue;
    const pending = data.assignments.some(
      (row) => row.entryKey === entry.key && row.role === "REFEREE" && !row.confirmed && row.userId === entry.matchRefereeId,
    );
    if (!pending) continue;
    await executor.execute(
      "UPDATE bg_planning_assignments SET confirmed = 1 WHERE entry_key = ? AND user_id = ? AND role = 'REFEREE' AND confirmed = 0",
      [entry.key, entry.matchRefereeId],
    );
    await writeEvent(executor, entry, entry.matchRefereeId, "REFEREE", "CONFIRMED", "AUTO", actorId);
    confirmed += 1;
  }
  return confirmed;
}

/**
 * Pose sur le match chaque arbitre de match à confirmer, l'un après l'autre.
 * Rend la panne qui a interrompu la série (`undefined` sinon) : les
 * désignations déjà décidées restent marquées `settled`, pour que le planning
 * les écrive quand même — jamais un match qui a son arbitre et un planning qui
 * le montre encore en proposition.
 */
async function designateReferees(steps: ConfirmStep[], actorId: number): Promise<unknown> {
  for (const step of steps) {
    const { entry } = step;
    if (entry.kind !== "MATCH" || step.role !== "REFEREE" || entry.matchId === null) continue;
    try {
      await assignMatchReferee(entry.matchId, actorId, step.userId, null);
    } catch (error) {
      if (!isMatchRefereeRefusal(error)) return error;
      step.refused = true;
    }
    step.settled = true;
  }
  return undefined;
}

/**
 * Confirme des propositions provisoires. Les autres restent provisoires, et
 * les lots suivants se calculent **autour** des confirmées. Un arbitre de
 * match est d'abord posé sur le match (`assignMatchReferee`, sans rien
 * remplacer) ; un refus du match (arbitre posé entre-temps, condition
 * d'arbitrage, joueur du match) retire la proposition, une panne fait
 * échouer le geste sans rien retirer. Les lignes du planning s'écrivent
 * ensuite d'un bloc (une transaction, ouverte **après** les désignations :
 * elle ne retient aucun match qu'une désignation attendrait) ; relancer le
 * geste retrouve les arbitres déjà posés.
 */
export async function confirmAssignments(
  actorId: number,
  scope: ConfirmScope,
  now: number = Date.now(),
): Promise<ConfirmReport> {
  return withPlanningLock(async (connection) => {
    const data = await loadPlanningData(connection, { now, includeHidden: true });
    const all = confirmSteps(data, scope);
    const failure = await designateReferees(all, actorId);
    // Une panne en route : seules s'écrivent les désignations que le match a
    // déjà décidées, puis la panne remonte (le geste se relance).
    const steps = failure === undefined ? all : all.filter((step) => step.settled);
    const report = await transact(connection, async () => {
      const healed = await confirmPendingReferees(connection, data, actorId);
      for (const step of steps) {
        if (step.refused) {
          await connection.execute(
            "DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = 'REFEREE' AND confirmed = 0",
            [step.entry.key, step.userId],
          );
          await writeEvent(connection, step.entry, step.userId, step.role, "REMOVED", "AUTO", actorId);
          continue;
        }
        await connection.execute(
          "UPDATE bg_planning_assignments SET confirmed = 1 WHERE entry_key = ? AND user_id = ? AND role = ?",
          [step.entry.key, step.userId, step.role],
        );
        await writeEvent(connection, step.entry, step.userId, step.role, "CONFIRMED", "AUTO", actorId);
      }
      const refused = steps.filter((step) => step.refused).length;
      return { confirmed: steps.length - refused + healed, refused };
    });
    if (failure !== undefined) throw failure;
    return report;
  });
}
