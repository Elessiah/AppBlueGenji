/**
 * Calcul automatique du planning, par lot (`docs/features/CAST_PLANNING.md`) :
 * rassemble ce que le calcul pur (`planning-planner.ts`) attend sur une
 * fenêtre de temps, remplace les propositions **provisoires** de la fenêtre,
 * et confirme celles que le staff retient. Sous le verrou nommé du planning :
 * un geste à la fois.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import { failureDiagnostic } from "@/lib/server/failure-reason";
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
 * d'un rôle d'une entrée n'y est pas replacé ; un tournoi encore caché n'est
 * proposé qu'à qui le voit (le staff des tournois, qui tient l'arbitrage).
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
  excludeFromHidden(data, entries, excluded);
  return excluded;
}

/**
 * Une entrée d'un tournoi encore caché n'est proposée qu'aux membres qui
 * voient les tournois cachés (permission `tournaments`, celle qui donne le rôle
 * d'arbitre) : un caster ou un prod sans elle n'y reçoit rien — ni sur sa page,
 * ni dans l'export de ses données.
 */
export function excludeFromHidden(data: Pick<PlanningData, "members">, entries: readonly LoadedEntry[], excluded: Set<string>): void {
  const hidden = entries.filter((entry) => entry.hidden);
  if (hidden.length === 0) return;
  for (const member of data.members) {
    if (member.roles.includes("REFEREE")) continue;
    for (const entry of hidden) {
      for (const role of member.roles) excluded.add(exclusionKey(entry.key, member.userId, role));
    }
  }
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
      locked.push({
        entryKey: entry.key,
        userId: row.userId,
        role: row.role,
        reason: row.reason,
        ...(row.provisional ? { provisional: true } : {}),
      });
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

/** Ce qu'un évènement retient de son entrée. */
export type EventEntry = Pick<LoadedEntry, "key" | "tournamentId" | "matchId">;

/** Écrit un évènement du planning ; rend son identifiant (qu'une annulation efface). */
export async function writeEvent(
  executor: Executor,
  entry: EventEntry,
  userId: number,
  role: PlanningRole,
  kind: "ASSIGNED" | "CONFIRMED" | "REMOVED",
  source: "AUTO" | "MANUAL",
  actorId: number,
): Promise<number> {
  const [result] = await executor.execute(
    `INSERT INTO bg_planning_events (entry_key, user_id, role, tournament_id, match_id, kind, source, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.key, userId, role, entry.tournamentId, entry.matchId, kind, source, actorId],
  );
  const id = Number((result as { insertId?: number } | undefined)?.insertId ?? 0);
  // Sans identifiant, une annulation ne saurait plus effacer cet évènement : panne franche.
  if (!Number.isInteger(id) || id <= 0) throw new Error("PLANNING_EVENT_ID_MISSING");
  return id;
}

/** Pose une ligne d'attribution (un choix du staff naît confirmé) et l'évènement qui la retrace (son identifiant rendu). */
export async function writeAssignment(
  executor: Executor,
  entry: LoadedEntry,
  row: { userId: number; role: PlanningRole; source: "AUTO" | "MANUAL"; reason: "PREFERENCE" | "LOAD" | "MANUAL" },
  actorId: number,
): Promise<number> {
  const confirmed = row.source === "MANUAL" ? 1 : 0;
  await executor.execute(
    `INSERT INTO bg_planning_assignments
       (entry_key, user_id, role, tournament_id, match_id, source, reason, confirmed, assigned_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE source = VALUES(source), reason = VALUES(reason), confirmed = VALUES(confirmed),
                             assigned_by_user_id = VALUES(assigned_by_user_id)`,
    [entry.key, row.userId, row.role, entry.tournamentId, entry.matchId, row.source, row.reason, confirmed, actorId],
  );
  return writeEvent(executor, entry, row.userId, row.role, "ASSIGNED", row.source, actorId);
}

/** Lignes par instruction d'écriture groupée. */
const WRITE_CHUNK = 200;

type PlannedRow = ReturnType<typeof planAssignments>[number];

const planKey = (entryKey: string, userId: number, role: PlanningRole) => `${entryKey}|${userId}|${role}`;

/**
 * Écrit les propositions d'un lot en quelques instructions groupées (et non
 * deux allers-retours par ligne, sous le verrou) : les lignes, puis un
 * évènement `ASSIGNED` seulement pour celles qui diffèrent de la proposition
 * précédente (même membre, même rôle, même motif : rien de nouveau à
 * retracer). Relancer un lot inchangé n'ajoute donc aucun évènement.
 */
async function writeProposals(
  executor: Executor,
  planned: readonly PlannedRow[],
  byKey: ReadonlyMap<string, LoadedEntry>,
  previous: ReadonlyMap<string, string>,
  actorId: number,
): Promise<number> {
  const rows = planned.flatMap((row) => {
    const entry = byKey.get(row.entryKey);
    return entry ? [{ row, entry }] : [];
  });
  for (let start = 0; start < rows.length; start += WRITE_CHUNK) {
    const chunk = rows.slice(start, start + WRITE_CHUNK);
    await executor.execute(
      `INSERT INTO bg_planning_assignments
         (entry_key, user_id, role, tournament_id, match_id, source, reason, confirmed, assigned_by_user_id)
       VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, 'AUTO', ?, 0, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE source = VALUES(source), reason = VALUES(reason), confirmed = VALUES(confirmed),
                               assigned_by_user_id = VALUES(assigned_by_user_id)`,
      chunk.flatMap(({ row, entry }) => [entry.key, row.userId, row.role, entry.tournamentId, entry.matchId, row.reason, actorId]),
    );
  }
  const changed = rows.filter(({ row }) => previous.get(planKey(row.entryKey, row.userId, row.role)) !== row.reason);
  for (let start = 0; start < changed.length; start += WRITE_CHUNK) {
    const chunk = changed.slice(start, start + WRITE_CHUNK);
    await executor.execute(
      `INSERT INTO bg_planning_events (entry_key, user_id, role, tournament_id, match_id, kind, source, actor_user_id)
       VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, 'ASSIGNED', 'AUTO', ?)").join(", ")}`,
      chunk.flatMap(({ row, entry }) => [entry.key, row.userId, row.role, entry.tournamentId, entry.matchId, actorId]),
    );
  }
  return rows.length;
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
    if (batch.length === 0) {
      await transact(connection, () => confirmPendingReferees(connection, actorId));
      return { entries: 0, proposed: 0, replaced: 0 };
    }
    const anchor = Math.max(now, window.from);
    const history = await loadPlanningHistory(connection, anchor);
    const excluded = await loadExclusions(connection, data, batch);
    const planned = planAssignments(preparePlanner(data, batch, history, excluded, planningWeekStart(anchor)));
    const keys = batch.map((entry) => entry.key);
    const byKey = new Map(batch.map((entry) => [entry.key, entry]));
    // Les propositions provisoires que le lot remplace : de quoi ne retracer que ce qui change.
    const previous = new Map(
      data.assignments
        .filter((row) => row.source === "AUTO" && !row.confirmed && byKey.has(row.entryKey))
        .map((row) => [planKey(row.entryKey, row.userId, row.role), row.reason]),
    );
    return transact(connection, async () => {
      await confirmPendingReferees(connection, actorId);
      const [cleared] = await connection.execute(
        `DELETE FROM bg_planning_assignments
          WHERE source = 'AUTO' AND confirmed = 0 AND entry_key IN (${keys.map(() => "?").join(", ")})`,
        keys,
      );
      const proposed = await writeProposals(connection, planned, byKey, previous, actorId);
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

/**
 * Les propositions à confirmer. Une proposition dont le membre ne tient plus
 * le rôle (rôle retiré, compte supprimé depuis le calcul : `data.members` est
 * relu à chaque geste) est retirée, jamais confirmée.
 */
export function confirmSteps(data: PlanningData, scope: ConfirmScope): ConfirmStep[] {
  const held = new Map(data.members.map((member) => [member.userId, member.roles]));
  const steps: ConfirmStep[] = [];
  for (const entry of entriesToConfirm(data, scope)) {
    for (const row of entryAssignments(entry, data).filter((candidate) => candidate.provisional)) {
      const stillHeld = held.get(row.userId)?.includes(row.role) ?? false;
      steps.push({ entry, userId: row.userId, role: row.role, refused: !stillHeld, settled: !stillHeld });
    }
  }
  return steps;
}

/** Confirme une proposition d'arbitre de match **seulement** si le match a (encore) cet arbitre. */
const CONFIRM_MATCH_REFEREE_SQL = `UPDATE bg_planning_assignments SET confirmed = 1
  WHERE entry_key = ? AND user_id = ? AND role = 'REFEREE' AND confirmed = 0
    AND EXISTS (SELECT 1 FROM bg_matches WHERE id = ? AND referee_user_id = ?)`;

/** Une proposition d'arbitre provisoire que le match porte déjà. */
const PENDING_ON_MATCH_SQL = `FROM bg_planning_assignments a JOIN bg_matches m ON m.id = a.match_id
  WHERE a.role = 'REFEREE' AND a.confirmed = 0 AND m.referee_user_id = a.user_id`;

/**
 * Réconcilie les arbitres de match du planning avec les matchs, en un nombre
 * fixe d'instructions. Une ligne d'arbitre **confirmée** que son match ne
 * porte pas (désignation restée incertaine après une panne, arbitre changé
 * depuis le match) est retirée : le match fait foi. Une proposition restée
 * provisoire alors que le match a déjà cet arbitre (confirmation interrompue
 * par une panne après la désignation) se confirme sans rien redemander au
 * match, que l'entrée soit ouverte, commencée ou hors de ce que montre le
 * planning ; ses évènements s'écrivent d'abord, d'après la même lecture
 * verrouillante (`INSERT … SELECT`), puis les lignes se confirment. Jouée au
 * début de chaque calcul (même sur une fenêtre vide) et de chaque
 * confirmation, dans leur transaction : un calcul relancé ne les efface donc
 * jamais comme de simples propositions.
 */
export async function confirmPendingReferees(executor: Executor, actorId: number): Promise<number> {
  await executor.execute(
    `DELETE a FROM bg_planning_assignments a JOIN bg_matches m ON m.id = a.match_id
      WHERE a.role = 'REFEREE' AND a.confirmed = 1 AND (m.referee_user_id IS NULL OR m.referee_user_id <> a.user_id)`,
  );
  await executor.execute(
    `INSERT INTO bg_planning_events (entry_key, user_id, role, tournament_id, match_id, kind, source, actor_user_id)
     SELECT a.entry_key, a.user_id, 'REFEREE', a.tournament_id, a.match_id, 'CONFIRMED', 'AUTO', ? ${PENDING_ON_MATCH_SQL}`,
    [actorId],
  );
  const [result] = await executor.execute(`UPDATE bg_planning_assignments a JOIN bg_matches m ON m.id = a.match_id
     SET a.confirmed = 1 WHERE a.role = 'REFEREE' AND a.confirmed = 0 AND m.referee_user_id = a.user_id`);
  return affected(result);
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
    const { matchId } = step.entry;
    if (!isMatchReferee(step) || matchId === null || step.settled) continue;
    try {
      // Sous le verrou, une désignation à la fois : un retrait du staff fait
      // depuis la lecture (proposition effacée) n'est pas défait sur le match.
      await withPlanningLock(async (connection) => {
        const [rows] = await connection.execute<RowDataPacket[]>(PROPOSAL_STILL_PENDING_SQL, [step.entry.key, step.userId]);
        if (rows.length === 0) return;
        await assignMatchReferee(matchId, actorId, step.userId, null);
      });
    } catch (error) {
      if (!isMatchRefereeRefusal(error)) return error;
      step.refused = true;
    }
    step.settled = true;
  }
  return undefined;
}

/** La proposition d'arbitre de match lue au calcul existe-t-elle encore (ni retirée, ni confirmée) ? */
export const PROPOSAL_STILL_PENDING_SQL = `SELECT 1 FROM bg_planning_assignments
  WHERE entry_key = ? AND user_id = ? AND role = 'REFEREE' AND confirmed = 0 LIMIT 1`;

function isMatchReferee(step: ConfirmStep): boolean {
  return step.entry.kind === "MATCH" && step.role === "REFEREE" && step.entry.matchId !== null;
}

/**
 * Les lignes d'une confirmation, d'un bloc : les propositions refusées par le
 * match retirées, les autres confirmées — un arbitre de match seulement si le
 * match l'a encore. Un évènement par ligne vraiment changée : relancer le
 * geste n'écrit rien deux fois.
 */
async function writeConfirmSteps(connection: PoolConnection, steps: readonly ConfirmStep[], actorId: number): Promise<ConfirmReport> {
  let confirmed = await confirmPendingReferees(connection, actorId);
  let refused = 0;
  for (const step of steps) {
    const { entry } = step;
    if (step.refused) {
      const [removed] = await connection.execute(
        "DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = ? AND confirmed = 0",
        [entry.key, step.userId, step.role],
      );
      if (affected(removed) === 0) continue;
      await writeEvent(connection, entry, step.userId, step.role, "REMOVED", "AUTO", actorId);
      refused += 1;
      continue;
    }
    const [result] = isMatchReferee(step)
      ? await connection.execute(CONFIRM_MATCH_REFEREE_SQL, [entry.key, step.userId, entry.matchId, step.userId])
      : await connection.execute(
          "UPDATE bg_planning_assignments SET confirmed = 1 WHERE entry_key = ? AND user_id = ? AND role = ? AND confirmed = 0",
          [entry.key, step.userId, step.role],
        );
    if (affected(result) === 0) continue;
    await writeEvent(connection, entry, step.userId, step.role, "CONFIRMED", "AUTO", actorId);
    confirmed += 1;
  }
  return { confirmed, refused };
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
  // Les désignations d'arbitres de match (chacune sa transaction, son
  // évènement) se font **avant** le verrou : le tenir pendant des dizaines
  // d'entre elles ferait échouer en `PLANNING_BUSY` tout autre geste du staff.
  // Elles sont idempotentes ; les écritures du planning, elles, sont sous le
  // verrou et gardées (une proposition effacée entre-temps n'est pas confirmée).
  const data = await withConnection((connection) => loadPlanningData(connection, { now, includeHidden: true }));
  const all = confirmSteps(data, scope);
  const failure = await designateReferees(all, actorId);
  return withPlanningLock(async (connection) => {
    // Une panne en route : les désignations que le match a déjà décidées et
    // les autres rôles (casters, prods, qui ne dépendent d'aucun match)
    // s'écrivent quand même, puis la panne d'origine remonte (le geste se relance).
    const steps = failure === undefined ? all : all.filter((step) => step.settled || !isMatchReferee(step));
    let report: ConfirmReport;
    try {
      report = await transact(connection, () => writeConfirmSteps(connection, steps, actorId));
    } catch (error) {
      if (failure === undefined) throw error;
      console.error("[planning] confirmation : écriture du planning en échec après une panne de désignation", failureDiagnostic(error));
      throw failure;
    }
    if (failure === undefined) return report;
    // Une partie est écrite : le staff doit le savoir (et relancer), la panne d'origine va au journal.
    if (report.confirmed + report.refused === 0) throw failure;
    console.error(
      `[planning] confirmation partielle (${report.confirmed} confirmée(s), ${report.refused} retirée(s)) après une panne de désignation`,
      failureDiagnostic(failure),
    );
    throw new Error("PLANNING_CONFIRM_PARTIAL");
  });
}
