/**
 * Désistement d'un membre affecté, et son remplacement automatique
 * (`docs/features/CAST_PLANNING.md` § Désistement).
 *
 * - **Qui** : le membre lui-même, sur sa **propre** attribution (la route
 *   passe le compte de la session). Le staff, lui, retire quelqu'un par la
 *   désignation à la main (`setManualAssignment`), qui l'écarte aussi.
 * - **Jusqu'à quand** : jusqu'au début de l'entrée ; à moins de 24 h, le
 *   désistement est dit **tardif** (`late`). Un caster inscrit sur le match
 *   (`bg_match_casters`) se retire depuis le match (`PLANNING_CAST_MANAGED`).
 * - **Trace** : un évènement `WITHDRAWN` (motif facultatif, lu du seul staff
 *   des tournois ; `source` dit si l'attribution quittée était confirmée). Il
 *   écarte ce membre de ce rôle de cette entrée pour les calculs suivants, et
 *   ne compte jamais comme charge (l'attribution est partie).
 * - **Arbitre d'un match** : retiré du match par `assignMatchReferee`, comme
 *   un retrait à la main (`unassignManually`) — match et planning ne se
 *   contredisent jamais ; un refus du match défait le désistement.
 * - **Remplacement** : le calcul du lot 1 (`planAssignments`) rouvre la seule
 *   entrée, tout le reste verrouillé, et prend son premier choix pour le rôle
 *   (disponible, sans chevauchement, ni joueur, ni retiré, ni suspendu, préférences
 *   d'abord, puis la charge). Attribution quittée **confirmée** : le
 *   remplaçant naît confirmé (posé sur le match pour un arbitre) et il est
 *   prévenu ; **provisoire** : il reste une proposition, sans message. Personne :
 *   la place est « à pourvoir » et le staff des tournois est prévenu.
 */
import type { PoolConnection } from "mysql2/promise";
import type { AuthUser } from "@/lib/server/auth";
import { failureReason } from "@/lib/server/failure-reason";
import { assignMatchReferee } from "@/lib/server/tournaments/match-launch";
import { transact } from "@/lib/server/tournaments/transaction";
import { can } from "@/lib/shared/permissions";
import { LATE_WITHDRAWAL_MS, planningWeekStart, WITHDRAWAL_REASON_MAX, type PlanningRole } from "@/lib/shared/planning";
import { planAssignments, type PlannedAssignment } from "@/lib/shared/planning-planner";
import { visibleText } from "@/lib/shared/visible-text";
import {
  isMatchRefereeRefusal,
  loadExclusions,
  lockedHolding,
  preparePlanner,
  withPlanningLock,
  writeEvent,
} from "./auto-assign";
import { loadPlanningData, loadPlanningHistory, type Executor, type LoadedEntry, type LoadedMember, type PlanningData } from "./load";
import { entryAssignments } from "./model";
import { announceWithdrawal } from "./notices";
import { readMatchReferee, settleFailedDesignation, snapshotGesture, type PlanningUndo } from "./planning-undo";

export type WithdrawalInput = { entryKey: string; role: PlanningRole; reason: string | null };

/** Issue d'un désistement, rendue à la page. */
export type WithdrawalResult = {
  late: boolean;
  /** Un remplaçant a été affecté. */
  replaced: boolean;
  /** Attribution confirmée quittée sans remplaçant : place « à pourvoir ». */
  unfilled: boolean;
};

/** Motif nettoyé (`visibleText`), `null` s'il est vide ; `undefined` s'il dépasse la borne. */
export function cleanWithdrawalReason(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const text = visibleText(value).trim();
  if (text.length === 0) return null;
  return Array.from(text).length > WITHDRAWAL_REASON_MAX ? undefined : text;
}

/** Désistement tardif : l'entrée commence dans moins de 24 h. */
export function isLateWithdrawal(startAt: number, now: number): boolean {
  return startAt - now < LATE_WITHDRAWAL_MS;
}

/** L'évènement du désistement ; rend son identifiant (qu'une désignation refusée efface). */
async function writeWithdrawalEvent(
  executor: Executor,
  entry: LoadedEntry,
  userId: number,
  input: WithdrawalInput,
  confirmed: boolean,
  late: boolean,
): Promise<number> {
  const [result] = await executor.execute(
    `INSERT INTO bg_planning_events
       (entry_key, user_id, role, tournament_id, match_id, kind, source, actor_user_id, reason, late)
     VALUES (?, ?, ?, ?, ?, 'WITHDRAWN', ?, NULL, ?, ?)`,
    [entry.key, userId, input.role, entry.tournamentId, entry.matchId, confirmed ? "MANUAL" : "AUTO", input.reason, late ? 1 : 0],
  );
  const id = Number((result as { insertId?: number } | undefined)?.insertId ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error("PLANNING_EVENT_ID_MISSING");
  return id;
}

/**
 * Le remplaçant : le calcul rouvre la seule entrée (toutes les autres
 * attributions verrouillées, provisoires comprises) et rend son premier choix
 * pour ce rôle. Relu après le désistement : le désisté est écarté
 * (`removals`), l'arbitre du match retiré.
 */
export function pickReplacement(
  data: PlanningData,
  entry: LoadedEntry,
  role: PlanningRole,
  history: ReadonlyMap<number, number>,
  excluded: ReadonlySet<string>,
  historyWeek: number,
): PlannedAssignment | null {
  const base = preparePlanner(data, [], history, excluded, historyWeek);
  const input = { ...base, entries: base.entries.map((item) => (item.key === entry.key ? { ...item, open: true } : item)) };
  return planAssignments(input).find((row) => row.entryKey === entry.key && row.role === role) ?? null;
}

async function findReplacement(
  connection: PoolConnection,
  entryKey: string,
  role: PlanningRole,
  now: number,
  members: LoadedMember[],
): Promise<{ data: PlanningData; entry: LoadedEntry | undefined; pick: PlannedAssignment | null }> {
  // Relu après le retrait (les affectations ont changé), mais pas les membres : déjà lus sous le même verrou.
  const data = await loadPlanningData(connection, { now, includeHidden: true, members });
  const entry = data.entries.find((candidate) => candidate.key === entryKey);
  if (!entry?.open || !entry.editable) return { data, entry, pick: null };
  const anchor = Math.max(now, entry.startAt);
  const history = await loadPlanningHistory(connection, anchor);
  const excluded = await loadExclusions(connection, data, [entry]);
  return { data, entry, pick: pickReplacement(data, entry, role, history, excluded, planningWeekStart(anchor)) };
}

/**
 * Pose le remplaçant ; rend `false` si le match ou ses rôles relus le
 * refusent (place alors à pourvoir). Arbitre de match confirmé : posé sur le
 * match d'abord (`assignMatchReferee`, qui juge condition d'arbitrage et
 * joueur), la ligne du planning ensuite — la réconciliation (`confirmPendingReferees`)
 * rattraperait une panne entre les deux. `actorId` : celui dont le geste
 * déclenche la pose (le désisté) ; le match ne s'en sert qu'à taire l'avis
 * d'un arbitre remplacé par lui-même — aucun ici, le match étant vide
 * (`expected` nul) — et ne le garde ni ne le publie.
 */
async function placeReplacement(
  connection: PoolConnection,
  entry: LoadedEntry,
  pick: PlannedAssignment,
  confirmed: boolean,
  actorId: number,
): Promise<boolean> {
  const matchReferee = entry.kind === "MATCH" && pick.role === "REFEREE" && entry.matchId !== null;
  if (matchReferee && confirmed) {
    try {
      await assignMatchReferee(entry.matchId as number, actorId, pick.userId, null);
    } catch (error) {
      if (!isMatchRefereeRefusal(error)) console.error("[planning] remplaçant d'arbitre non posé.", failureReason(error));
      return false;
    }
  }
  try {
    return await placeReplacementRow(connection, entry, pick, confirmed, matchReferee && confirmed);
  } catch (error) {
    console.error("[planning] remplaçant non inscrit au planning.", failureReason(error));
    // Arbitre déjà posé sur le match : il tient le rôle (le tableau le lit du
    // match), la réconciliation écrira sa ligne. Sinon, la place reste à pourvoir.
    return matchReferee && confirmed;
  }
}

/** La ligne du remplaçant au planning, et ses évènements (une transaction). */
function placeReplacementRow(
  connection: PoolConnection,
  entry: LoadedEntry,
  pick: PlannedAssignment,
  confirmed: boolean,
  onMatch: boolean,
): Promise<boolean> {
  return transact(connection, async () => {
    if (!onMatch) {
      const holds = await lockedHolding(connection, [{ userId: pick.userId, entry }]);
      if (holds(pick.userId, entry, pick.role) !== null) return false;
    }
    await connection.execute(
      `INSERT INTO bg_planning_assignments
         (entry_key, user_id, role, tournament_id, match_id, source, reason, confirmed, assigned_by_user_id)
       VALUES (?, ?, ?, ?, ?, 'AUTO', ?, ?, NULL)
       ON DUPLICATE KEY UPDATE source = VALUES(source), reason = VALUES(reason), confirmed = VALUES(confirmed),
                               assigned_by_user_id = NULL`,
      [entry.key, pick.userId, pick.role, entry.tournamentId, entry.matchId, pick.reason, confirmed ? 1 : 0],
    );
    await writeEvent(connection, entry, pick.userId, pick.role, "ASSIGNED", "AUTO", null);
    if (confirmed) await writeEvent(connection, entry, pick.userId, pick.role, "CONFIRMED", "AUTO", null);
    return true;
  });
}

/** L'attribution que `user` quitte, ou le refus par code. */
function withdrawnAssignment(user: AuthUser, input: WithdrawalInput, data: PlanningData, now: number) {
  const entry = data.entries.find((candidate) => candidate.key === input.entryKey);
  if (!entry) throw new Error("PLANNING_ENTRY_NOT_FOUND");
  if (!entry.editable || entry.startAt <= now) throw new Error("PLANNING_WITHDRAWAL_CLOSED");
  const current = entryAssignments(entry, data).find((row) => row.userId === user.id && row.role === input.role);
  if (!current) throw new Error("PLANNING_NOT_ASSIGNED");
  if (current.source === "CAST") throw new Error("PLANNING_CAST_MANAGED");
  return { entry, current };
}

/**
 * Retire l'arbitre désigné du match s'il s'agit encore de `userId` ; un refus
 * défait le geste. Rend l'arbitre que le match porte déjà quand c'est **un
 * autre** (changé depuis la fenêtre « Arbitrage » entre la lecture et ce
 * retrait) : le rôle est tenu, il n'y a ni remplaçant à chercher ni place à
 * pourvoir. `null` sinon.
 */
async function releaseMatchReferee(matchId: number, userId: number, undo: PlanningUndo, eventIds: readonly number[]): Promise<number | null> {
  const carried = await readMatchReferee(matchId);
  if (carried !== undefined && carried !== userId) return carried;
  try {
    await assignMatchReferee(matchId, userId, null, userId);
  } catch (error) {
    await settleFailedDesignation(error, matchId, null, undo, eventIds);
    throw error;
  }
  return null;
}

/** Les autres affectés tenus de l'entrée : ni le désisté, ni le remplaçant. */
function coAssigned(entry: LoadedEntry, data: PlanningData, userId: number, replacementId: number | null): number[] {
  return entryAssignments(entry, data)
    .filter((row) => !row.provisional && row.userId !== userId && row.userId !== replacementId)
    .map((row) => row.userId);
}

/**
 * Cherche et pose le remplaçant, une fois le désistement acquis. Une panne
 * ici ne défait pas le désistement déjà écrit : la place reste à pourvoir et
 * l'annonce part quand même (co-affectés, staff), au lieu d'un échec rendu
 * pour un geste fait.
 */
async function replaceWithdrawn(
  connection: PoolConnection,
  gesture: { entry: LoadedEntry; data: PlanningData; role: PlanningRole; now: number; confirmed: boolean; userId: number },
): Promise<{ fresh: LoadedEntry; replacementId: number | null; coAssignedIds: number[] }> {
  const { entry, data, role, now, confirmed, userId } = gesture;
  try {
    const found = await findReplacement(connection, entry.key, role, now, data.members);
    const fresh = found.entry ?? entry;
    const placed = found.pick !== null && (await placeReplacement(connection, fresh, found.pick, confirmed, userId));
    const replacementId = placed && found.pick ? found.pick.userId : null;
    return { fresh, replacementId, coAssignedIds: coAssigned(fresh, found.data, userId, replacementId) };
  } catch (error) {
    console.error("[planning] remplaçant introuvable après un désistement.", failureReason(error));
    return { fresh: entry, replacementId: null, coAssignedIds: coAssigned(entry, data, userId, null) };
  }
}

type Outcome = WithdrawalResult & {
  confirmed: boolean;
  entry: LoadedEntry;
  replacementId: number | null;
  coAssignedIds: number[];
};

/**
 * Le membre `user` se désiste de son attribution `input.role` sur
 * `input.entryKey`. Erreurs par code : `PLANNING_ENTRY_NOT_FOUND`,
 * `PLANNING_WITHDRAWAL_CLOSED` (entrée commencée ou close),
 * `PLANNING_NOT_ASSIGNED`, `PLANNING_CAST_MANAGED`, refus du match.
 */
export async function withdrawFromEntry(user: AuthUser, input: WithdrawalInput, now: number = Date.now()): Promise<WithdrawalResult> {
  const outcome = await withPlanningLock(async (connection): Promise<Outcome> => {
    const data = await loadPlanningData(connection, { now, includeHidden: can(user, "tournaments") });
    const { entry, current } = withdrawnAssignment(user, input, data, now);
    const confirmed = !current.provisional;
    const late = isLateWithdrawal(entry.startAt, now);
    // L'arbitre d'un match passe par le match ; une proposition provisoire n'y est pas encore.
    const matchId = entry.kind === "MATCH" && input.role === "REFEREE" && confirmed ? entry.matchId : null;
    const undo =
      matchId === null ? undefined : await snapshotGesture(connection, [entry.key], { entryKey: entry.key, userId: user.id, role: input.role });
    const eventIds = await transact(connection, async () => {
      await connection.execute("DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = ?", [
        entry.key,
        user.id,
        input.role,
      ]);
      return [await writeWithdrawalEvent(connection, entry, user.id, input, confirmed, late)];
    });
    const heldBy = matchId !== null && undo !== undefined ? await releaseMatchReferee(matchId, user.id, undo, eventIds) : null;
    if (heldBy !== null) {
      // Les co-affectés se lisent dans `data` (lu sous le même verrou) : seule la ligne du désisté a changé.
      return {
        late,
        replaced: false,
        unfilled: false,
        confirmed,
        entry,
        replacementId: null,
        // L'arbitre posé par le staff n'apprend pas un désistement d'une place qu'il tient déjà.
        coAssignedIds: coAssigned(entry, data, user.id, heldBy),
      };
    }
    const { fresh, replacementId, coAssignedIds } = await replaceWithdrawn(connection, { entry, data, role: input.role, now, confirmed, userId: user.id });
    return {
      late,
      replaced: replacementId !== null,
      unfilled: confirmed && replacementId === null,
      confirmed,
      entry: fresh,
      replacementId,
      coAssignedIds,
    };
  });
  // Une simple proposition quittée n'avait été annoncée à personne : rien à dire.
  // Les envois partent après le verrou, sans faire attendre la page (ils ne lèvent jamais).
  if (outcome.confirmed) {
    void announceWithdrawal({
      entry: outcome.entry,
      role: input.role,
      late: outcome.late,
      withdrawnUserId: user.id,
      replacementId: outcome.replacementId,
      unfilled: outcome.unfilled,
      coAssignedIds: outcome.coAssignedIds,
    });
  }
  return { late: outcome.late, replaced: outcome.replaced, unfilled: outcome.unfilled };
}
