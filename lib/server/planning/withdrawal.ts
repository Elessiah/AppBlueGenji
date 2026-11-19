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
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import type { AuthUser } from "@/lib/server/auth";
import { failureReason } from "@/lib/server/failure-reason";
import { assignMatchReferee } from "@/lib/server/tournaments/match-launch";
import { transact } from "@/lib/server/tournaments/transaction";
import { can } from "@/lib/shared/permissions";
import { LATE_WITHDRAWAL_MS, PLANNING_MAX_CASTERS, planningWeekStart, WITHDRAWAL_REASON_MAX, type PlanningRole } from "@/lib/shared/planning";
import { exclusionKey, planAssignments, type PlannedAssignment, type PlannerInput } from "@/lib/shared/planning-planner";
import type { PlanningAssignmentView } from "@/lib/shared/planning-view";
import { visibleText } from "@/lib/shared/visible-text";
import {
  isMatchRefereeRefusal,
  loadExclusions,
  lockedHolding,
  preparePlanner,
  withPlanningLock,
  writeEvent,
} from "./auto-assign";
import { coveringSoloCasterIds, loadPlanningData, loadPlanningHistory, type Executor, type LoadedEntry, type LoadedMember, type PlanningData } from "./load";
import { entryAssignments, entryCoverage } from "./model";
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
  /** Avec `unfilled` : le départ d'un caster autonome a fait perdre la diffusion. */
  streamLost: boolean;
  /**
   * Caster encore inscrit sur le match (`CAST`), seul à tenir le rôle : il le
   * cast toujours, rien n'a changé — ni remplaçant, ni place à pourvoir ; il
   * se retire depuis le match.
   */
  stillSignedUp: boolean;
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
  /** `null` : le membre se désiste lui-même ; sinon le staff qui sort un invité du planning. */
  actorId: number | null,
): Promise<number> {
  const [result] = await executor.execute(
    `INSERT INTO bg_planning_events
       (entry_key, user_id, role, tournament_id, match_id, kind, source, actor_user_id, reason, late)
     VALUES (?, ?, ?, ?, ?, 'WITHDRAWN', ?, ?, ?, ?)`,
    [entry.key, userId, input.role, entry.tournamentId, entry.matchId, confirmed ? "MANUAL" : "AUTO", actorId, input.reason, late ? 1 : 0],
  );
  const id = Number((result as { insertId?: number } | undefined)?.insertId ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error("PLANNING_EVENT_ID_MISSING");
  return id;
}

/**
 * Le remplaçant : le calcul rouvre la seule entrée (toutes les autres
 * attributions verrouillées, provisoires comprises) et rend son premier choix
 * pour ce rôle. Relu après le désistement : le désisté est écarté
 * (`removals`), l'arbitre du match retiré. Un caster quitté alors qu'un autre
 * caster **confirmé** tient encore l'entrée était un renfort
 * (`PLANNING_MAX_CASTERS`) : il n'est remplacé que par un caster libre, attendu
 * sur aucune entrée qui la chevauche (la règle du second caster du calcul),
 * cherché seul (`spareOnly`). Un caster autonome parti en emportant la
 * diffusion (`streamLost`, {@link casterHold}) n'est remplacé que par un
 * caster autonome, qui la rend, même attendu ailleurs — sauf si un prod est
 * déjà proposé auprès du caster restant : la règle du renfort est tentée
 * d'abord, le caster autonome à défaut. Une simple proposition de caster
 * restée sur l'entrée ne la tient pas : la place quittée est la première.
 */
export function pickReplacement(
  data: PlanningData,
  entry: LoadedEntry,
  role: PlanningRole,
  history: ReadonlyMap<number, number>,
  excluded: ReadonlySet<string>,
  historyWeek: number,
  streamLost = false,
): PlannedAssignment | null {
  const all = role === "CASTER" ? entryAssignments(entry, data) : [];
  // Le plafond compte toute ligne de caster restée (proposition, inscription au match, compte suspendu compris),
  // comme la pose à la main : un remplaçant ne le dépasse jamais.
  if (new Set(all.filter((row) => row.role === "CASTER").map((row) => row.userId)).size >= PLANNING_MAX_CASTERS) return null;
  const base = preparePlanner(data, [], history, excluded, historyWeek);
  const suspended = suspendedIds(data);
  // Un compte suspendu ne tient rien (il ne peut pas venir) : ni renfort, ni place prise sous le plafond.
  const rows = all.filter((row) => !suspended.has(row.userId));
  const casters = rows.filter((row) => row.role === "CASTER");
  // Renfort : un autre caster **confirmé** tient l'entrée. Sinon la place quittée est la première, et une simple
  // proposition de caster restée sur l'entrée ne la tient pas : écartée de ce seul calcul, elle reste en base.
  const spare = casters.some((row) => !row.provisional);
  const proposals = new Set(spare ? [] : casters.filter((row) => row.provisional).map((row) => row.userId));
  // Un caster suspendu s'écarte de ce seul calcul comme une proposition (il reste en base, l'exclusion l'y garde ;
  // `preparePlanner` ne verrouille déjà aucune ligne d'un compte suspendu hors lot).
  for (const row of all) if (row.role === "CASTER" && suspended.has(row.userId)) proposals.add(row.userId);
  // Ce qui ne change pas d'un essai à l'autre se prépare une fois (les deux essais d'une diffusion perdue le partagent).
  const locked = base.locked.filter((row) => !(row.entryKey === entry.key && row.role === "CASTER" && proposals.has(row.userId)));
  const excludedWithProposals = proposals.size === 0 ? base.excluded : new Set([...base.excluded, ...[...proposals].map((userId) => exclusionKey(entry.key, userId, "CASTER"))]);
  const plan = (restoreStream: boolean): PlannedAssignment | null => {
    const input: PlannerInput = {
      ...base,
      // Un renfort se cherche seul : rien d'autre n'est posé sur l'entrée (aucun prod d'essai qui écarterait un candidat).
      entries: base.entries.map((item) => (item.key === entry.key ? { ...item, open: true, spareOnly: spare, restoreStream } : item)),
      locked,
      excluded: excludedWithProposals,
      spareCasters: spare,
    };
    return planAssignments(input).find((row) => row.entryKey === entry.key && row.role === role) ?? null;
  };
  // Diffusion perdue (rôles confirmés seuls) : seul un renfort la rend. Un prod proposé auprès du caster restant la
  // tiendra une fois confirmé : la règle ordinaire du renfort est tentée d'abord, le caster autonome à défaut.
  if (!spare || !streamLost) return plan(false);
  const proposedStream = entryCoverage(rows, base.soloCasterIds).streamed;
  return (proposedStream ? plan(false) : null) ?? plan(true);
}

async function findReplacement(
  connection: PoolConnection,
  entryKey: string,
  role: PlanningRole,
  now: number,
  members: LoadedMember[],
  withdrawn: PlanningAssignmentView,
  before: LoadedEntry,
): Promise<{ data: PlanningData; entry: LoadedEntry | undefined; hold: CasterHolds; pick: PlannedAssignment | null }> {
  // Relu après le retrait (les affectations ont changé), mais pas les membres : déjà lus sous le même verrou.
  const data = await loadPlanningData(connection, { now, includeHidden: true, members });
  const entry = data.entries.find((candidate) => candidate.key === entryKey);
  // Jugé sur la relecture : une inscription de cast (hors verrou du planning) faite ou défaite entre-temps y compte.
  const hold = casterHolds(entry ?? before, data, withdrawn);
  // Encore inscrit sur le match, seul à tenir le rôle, le désisté le cast toujours : rien à remplacer.
  if (!entry?.open || !entry.editable || selfOnly(hold.staff)) return { data, entry, hold, pick: null };
  // Personne d'autre n'a répondu « disponible » pour ce rôle : aucun remplaçant possible, on s'épargne l'historique,
  // les exclusions et le calcul (le cas courant d'un renfort quitté).
  const offered = data.availability.some(
    (row) => row.entryKey === entryKey && row.role === role && row.status === "AVAILABLE" && row.userId !== withdrawn.userId,
  );
  if (!offered) return { data, entry, hold, pick: null };
  const anchor = Math.max(now, entry.startAt);
  const history = await loadPlanningHistory(connection, anchor);
  // Les voisines ne servent qu'au renfort d'un caster (`neededElsewhere`) : inutiles pour un prod ou un arbitre.
  const excluded = await loadExclusions(connection, data, [entry], { neighbours: role === "CASTER" });
  return { data, entry, hold, pick: pickReplacement(data, entry, role, history, excluded, planningWeekStart(anchor), hold.staff.streamLost) };
}

/**
 * Pose le remplaçant ; rend `false` si le match ou ses rôles relus le
 * refusent (place alors à pourvoir). Arbitre de match confirmé : posé sur le
 * joueur), la ligne du planning ensuite. Une panne de la désignation peut
 * survenir après sa validation : le match relu dit si le remplaçant y est posé
 * (sa ligne s'écrit alors quand même). `actorId` : celui dont le geste
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
      // Suspension jugée dans la transaction même du match : posée depuis le choix, la place reste à pourvoir.
      await assignMatchReferee(entry.matchId as number, actorId, pick.userId, null, { refuseSuspended: true });
    } catch (error) {
      if (isMatchRefereeRefusal(error)) return false;
      // Panne : posé malgré elle (validation faite, réponse perdue), le remplaçant tient le rôle.
      if ((await readMatchReferee(entry.matchId as number)) !== pick.userId) {
        console.error("[planning] remplaçant d'arbitre non posé.", failureReason(error));
        return false;
      }
    }
  }
  try {
    return await placeReplacementRow(connection, entry, pick, confirmed, matchReferee && confirmed);
  } catch (error) {
    console.error("[planning] remplaçant non inscrit au planning.", failureReason(error));
    // Arbitre déjà posé sur le match : il tient le rôle (le tableau le lit du
    // match, qui fait foi). Sinon, la place reste à pourvoir.
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
function withdrawnAssignment(user: { id: number }, input: WithdrawalInput, data: PlanningData, now: number) {
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
async function releaseMatchReferee(
  matchId: number,
  userId: number,
  actorId: number,
  undo: PlanningUndo,
  eventIds: readonly number[],
): Promise<number | null> {
  const carried = await readMatchReferee(matchId);
  if (carried !== undefined && carried !== userId) return carried;
  try {
    await assignMatchReferee(matchId, actorId, null, userId);
  } catch (error) {
    await settleFailedDesignation(error, matchId, null, undo, eventIds);
    throw error;
  }
  return null;
}

/**
 * Un caster quitté dont l'entrée garde un **autre** caster confirmé (le
 * second caster, `PLANNING_MAX_CASTERS`). `casterIds` : ces casters restants,
 * le désisté jamais compris, qui tiennent le rôle — la place n'est pas « à pourvoir » et le staff n'est
 * pas prévenu — si le départ n'ôte pas la diffusion (rôles confirmés seuls,
 * `entryCoverage`) ; vide sinon. `streamLost` : un caster autonome est parti
 * en laissant un caster sans prod — la place est à pourvoir et le staff
 * prévenu. Les autres rôles (dont le groupe d'arbitres d'un tournoi entier)
 * gardent leur règle. `data` : lu avant le retrait, sous le même verrou ;
 * `withdrawn` : la ligne quittée telle qu'elle était (seule elle est ôtée,
 * membre **et** rôle). Une simple proposition quittée ne tenait aucune
 * diffusion : jamais `streamLost`.
 */
type CasterHold = {
  casterIds: number[];
  /** Le désisté, encore inscrit sur le match (`CAST`), cast toujours : il tient le rôle sans être « un autre caster ». */
  selfHeld: boolean;
  streamLost: boolean;
};

/** Le rôle de caster reste tenu, par un autre caster ou par le désisté encore inscrit. */
function held(hold: CasterHold): boolean {
  return hold.casterIds.length > 0 || hold.selfHeld;
}

/** Le désisté, encore inscrit sur le match, est seul à tenir le rôle : il le cast toujours. */
function selfOnly(hold: CasterHold): boolean {
  return hold.selfHeld && hold.casterIds.length === 0;
}

/**
 * `skipSuspended` : un compte suspendu ne tient rien (ni caster, ni prod, ni
 * caster autonome) — vue du calcul et du staff des tournois. Faux : la vue
 * des autres membres, où rien ne trahit la suspension (`coveringSoloCasterIds`).
 * L'inscription au match (`CAST`) du désisté reste : il cast encore le match.
 */
export function casterHold(
  entry: LoadedEntry,
  data: PlanningData,
  withdrawn: PlanningAssignmentView,
  skipSuspended = false,
): CasterHold {
  if (withdrawn.role !== "CASTER") return { casterIds: [], selfHeld: false, streamLost: false };
  const suspended = skipSuspended ? suspendedIds(data) : new Set<number>();
  // Inscrit sur le match, le désisté le cast encore : sur une lecture d'avant le retrait (repli), sa ligne du
  // planning masque l'inscription (`entryAssignments`), elle compte donc comme celle-ci.
  const signedUp = (data.matchCasters.get(entry.key) ?? []).includes(withdrawn.userId);
  const kept = entryAssignments(entry, data).filter(
    (row) =>
      !row.provisional &&
      !suspended.has(row.userId) &&
      !(row.userId === withdrawn.userId && row.role === "CASTER" && row.source !== "CAST" && !signedUp),
  );
  const casterIds = kept.filter((row) => row.role === "CASTER").map((row) => row.userId);
  if (casterIds.length === 0) return { casterIds: [], selfHeld: false, streamLost: false };
  const solo = coveringSoloCasterIds(data.members, skipSuspended);
  const streamLost =
    !withdrawn.provisional && entryCoverage([...kept, withdrawn], solo).streamed && !entryCoverage(kept, solo).streamed;
  if (streamLost) return { casterIds: [], selfHeld: false, streamLost };
  const others = casterIds.filter((id) => id !== withdrawn.userId);
  return { casterIds: others, selfHeld: others.length < casterIds.length, streamLost };
}

/**
 * Les deux lectures d'un désistement de caster : `shown`, celle des membres
 * (annonces aux co-affectés, message rendu au désisté) ; `staff`, celle du
 * calcul et du staff des tournois, où un compte suspendu ne tient rien. Un
 * caster restant suspendu ne retient donc ni le remplacement ni l'alerte du
 * staff, sans que les autres membres l'apprennent.
 */
type CasterHolds = { shown: CasterHold; staff: CasterHold };

export function casterHolds(entry: LoadedEntry, data: PlanningData, withdrawn: PlanningAssignmentView): CasterHolds {
  return { shown: casterHold(entry, data, withdrawn, false), staff: casterHold(entry, data, withdrawn, true) };
}

/** Les comptes suspendus parmi les membres (lus avec eux, `LoadedMember.suspended`). */
function suspendedIds(data: Pick<PlanningData, "members">): Set<number> {
  return new Set(data.members.filter((member) => member.suspended).map((member) => member.userId));
}

/**
 * Les autres affectés tenus de l'entrée : ni le remplaçant, ni la ligne
 * quittée (membre **et** rôle) ; le désisté lui-même est écarté à l'envoi.
 */
function coAssigned(entry: LoadedEntry, data: PlanningData, userId: number, role: PlanningRole, replacementId: number | null): number[] {
  return entryAssignments(entry, data)
    .filter((row) => !row.provisional && !(row.userId === userId && row.role === role) && row.userId !== replacementId)
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
  gesture: { entry: LoadedEntry; data: PlanningData; current: PlanningAssignmentView; now: number; confirmed: boolean; userId: number },
): Promise<{ fresh: LoadedEntry; replacementId: number | null; coAssignedIds: number[]; hold: CasterHolds }> {
  const { entry, data, current, now, confirmed, userId } = gesture;
  const role = current.role;
  try {
    const found = await findReplacement(connection, entry.key, role, now, data.members, current, entry);
    const fresh = found.entry ?? entry;
    const placed = found.pick !== null && (await placeReplacement(connection, fresh, found.pick, confirmed, userId));
    const replacementId = placed && found.pick ? found.pick.userId : null;
    return {
      fresh,
      replacementId,
      coAssignedIds: coAssigned(fresh, found.data, userId, role, replacementId),
      hold: found.hold,
    };
  } catch (error) {
    console.error("[planning] remplaçant introuvable après un désistement.", failureReason(error));
    // Relecture en panne : la lecture d'avant le retrait, sous le même verrou, en tient lieu.
    return {
      fresh: entry,
      replacementId: null,
      coAssignedIds: coAssigned(entry, data, userId, role, null),
      hold: casterHolds(entry, data, current),
    };
  }
}

type Outcome = WithdrawalResult & {
  /** Les autres casters confirmés qui tiennent encore l'entrée sans remplaçant (aucune place à pourvoir) ; vide sinon. */
  stillHeldBy: number[];
  /** La place vue du staff (un compte suspendu n'y tient rien) : à pourvoir, diffusion perdue ou non ; `null` sinon. */
  staffUnfilled: { streamLost: boolean } | null;
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
  return withdrawMember({ id: user.id, includeHidden: can(user, "tournaments"), actorId: null }, input, now);
}

/**
 * Le désistement lui-même, pour le compte `user.id` : celui de la session
 * ({@link withdrawFromEntry}, `actorId: null`) ou un invité que le staff
 * `actorId` sort du planning ({@link releaseGuestPlanning}). Posé par le
 * staff, il n'est jamais « tardif » (ce n'est pas un désistement du membre),
 * il porte son auteur, et le match nomme le staff comme auteur du retrait
 * d'un arbitre. `includeHidden` : les entrées des tournois encore cachés sont lues.
 */
async function withdrawMember(
  user: { id: number; includeHidden: boolean; actorId: number | null },
  input: WithdrawalInput,
  now: number,
): Promise<WithdrawalResult> {
  const outcome = await withPlanningLock(async (connection): Promise<Outcome> => {
    const data = await loadPlanningData(connection, { now, includeHidden: user.includeHidden });
    const { entry, current } = withdrawnAssignment(user, input, data, now);
    const confirmed = !current.provisional;
    const late = user.actorId === null && isLateWithdrawal(entry.startAt, now);
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
      return [await writeWithdrawalEvent(connection, entry, user.id, input, confirmed, late, user.actorId)];
    });
    const heldBy = matchId !== null && undo !== undefined ? await releaseMatchReferee(matchId, user.id, user.actorId ?? user.id, undo, eventIds) : null;
    if (heldBy !== null) {
      // Les co-affectés se lisent dans `data` (lu sous le même verrou) : seule la ligne du désisté a changé.
      return {
        late,
        replaced: false,
        unfilled: false,
        stillHeldBy: [],
        streamLost: false,
        stillSignedUp: false,
        staffUnfilled: null,
        confirmed,
        entry,
        replacementId: null,
        // L'arbitre posé par le staff n'apprend pas un désistement d'une place qu'il tient déjà.
        coAssignedIds: coAssigned(entry, data, user.id, input.role, heldBy),
      };
    }
    const { fresh, replacementId, coAssignedIds, hold } = await replaceWithdrawn(connection, {
      entry,
      data,
      current,
      now,
      confirmed,
      userId: user.id,
    });
    const open = confirmed && replacementId === null;
    // Inscrit sur le match, le désisté le cast encore (`selfHeld`) ; seul à tenir le rôle, rien ne change pour
    // les autres membres (le planning le montre toujours caster), qui n'ont rien à apprendre.
    const selfKept = replacementId === null && selfOnly(hold.shown);
    return {
      late,
      replaced: replacementId !== null,
      unfilled: open && !held(hold.shown),
      stillHeldBy: replacementId === null ? hold.shown.casterIds : [],
      streamLost: open && hold.shown.streamLost,
      stillSignedUp: selfKept,
      // La lecture du staff ne retire que des comptes suspendus à celle des membres : une place à pourvoir pour eux
      // (diffusion perdue comprise) l'est aussi pour le staff, et le message rendu au désisté (« le staff est
      // prévenu ») ne ment pas.
      staffUnfilled: open && !held(hold.staff) ? { streamLost: hold.staff.streamLost } : null,
      confirmed,
      entry: fresh,
      replacementId,
      coAssignedIds: selfKept ? [] : coAssignedIds,
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
      stillHeldBy: outcome.stillHeldBy,
      streamLost: outcome.streamLost,
      staffUnfilled: outcome.staffUnfilled,
      coAssignedIds: outcome.coAssignedIds,
    });
  }
  return {
    late: outcome.late,
    replaced: outcome.replaced,
    unfilled: outcome.unfilled,
    streamLost: outcome.streamLost,
    stillSignedUp: outcome.stillSignedUp,
  };
}

/** Bilan de la sortie d'un invité du planning ({@link releaseGuestPlanning}). */
export type GuestRelease = {
  /** Attributions à venir quittées (par le désistement ordinaire). */
  withdrawn: number;
  /** Attributions qu'un refus ou une panne a laissées en place (le staff les retire à la main). */
  failed: number;
  /** Disponibilités à venir effacées. */
  availabilityCleared: number;
};

/** Refus qui disent que l'attribution est déjà partie (sortie concurrente, entrée commencée entre-temps) : rien à quitter. */
const ALREADY_GONE = new Set(["PLANNING_NOT_ASSIGNED", "PLANNING_WITHDRAWAL_CLOSED", "PLANNING_ENTRY_NOT_FOUND"]);

/**
 * Un compte devenu **invité** (`bg_users.is_guest_staff`, `CAST_PLANNING.md`
 * § Invités) quitte le planning à venir, par le staff `actorId` : chacune de
 * ses attributions d'une entrée pas encore commencée passe par le désistement
 * ordinaire (remplaçant, place « à pourvoir », annonces — sans motif, jamais
 * tardif, auteur noté ; il n'écarte pas le compte des calculs suivants s'il
 * redevient membre), puis ses disponibilités de ces entrées sont effacées. Le
 * passé (entrées commencées, historique) ne bouge pas ; une inscription de
 * cast sur un match (`CAST`) ou un arbitre désigné hors du planning (`MATCH`)
 * restent : ils se gèrent depuis le match. Appelé **après** l'écriture du
 * drapeau : le calcul du remplaçant ne le compte déjà plus parmi les membres.
 * Rejouable : une attribution déjà partie (sortie concurrente) est passée sans
 * bruit. Ne lève pas : une attribution refusée ou en panne, ou la lecture du
 * planning en panne, est comptée (`failed`) et journalisée.
 */
export async function releaseGuestPlanning(userId: number, actorId: number, now: number = Date.now()): Promise<GuestRelease> {
  const result: GuestRelease = { withdrawn: 0, failed: 0, availabilityCleared: 0 };
  let upcoming: { entryKey: string; role: PlanningRole }[];
  let futureKeys: string[];
  try {
    const db = await getDatabase();
    // Ses seules disponibilités : celles des autres ne servent pas ici.
    const data = await loadPlanningData(db, { now, includeHidden: true, availabilityOf: userId });
    const future = data.entries.filter((entry) => entry.startAt > now);
    futureKeys = future.map((entry) => entry.key);
    upcoming = future.filter((entry) => entry.editable).flatMap((entry) =>
      entryAssignments(entry, data)
        .filter((row) => row.userId === userId && (row.source === "AUTO" || row.source === "MANUAL"))
        .map((row) => ({ entryKey: entry.key, role: row.role })),
    );
  } catch (error) {
    console.error("[planning] sortie d'un invité : lecture du planning impossible.", failureReason(error));
    // Rien n'a pu être quitté : le staff l'apprend (`failed`) au lieu d'un succès.
    return { ...result, failed: 1 };
  }
  for (const row of upcoming) {
    try {
      await withdrawMember({ id: userId, includeHidden: true, actorId }, { entryKey: row.entryKey, role: row.role, reason: null }, now);
      result.withdrawn += 1;
    } catch (error) {
      if (ALREADY_GONE.has((error as Error)?.message)) continue;
      result.failed += 1;
      console.error(`[planning] sortie d'un invité : attribution ${row.entryKey} (${row.role}) laissée en place.`, failureReason(error));
    }
  }
  if (futureKeys.length > 0) {
    try {
      const db = await getDatabase();
      const [deleted] = await db.execute<ResultSetHeader>(
        `DELETE FROM bg_planning_availability WHERE user_id = ? AND entry_key IN (${futureKeys.map(() => "?").join(", ")})`,
        [userId, ...futureKeys],
      );
      result.availabilityCleared = Number(deleted.affectedRows ?? 0);
    } catch (error) {
      console.error("[planning] sortie d'un invité : disponibilités non effacées.", failureReason(error));
    }
  }
  return result;
}
