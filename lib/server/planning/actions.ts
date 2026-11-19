/**
 * Gestes du planning (`docs/features/CAST_PLANNING.md`) : sa disponibilité,
 * le réglage « caster autonome », la désignation à la main par le staff.
 * Chaque geste relit l'entrée en base ; une erreur se lève par son **code**,
 * que la route traduit (`PLANNING_STATUSES`).
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { AuthUser } from "@/lib/server/auth";
import { withConnection } from "@/lib/server/database";
import { assignMatchReferee } from "@/lib/server/tournaments/match-launch";
import { transact } from "@/lib/server/tournaments/transaction";
import { can } from "@/lib/shared/permissions";
import { planningCastersFull, planningRolesOf, type AvailabilityStatus, type PlanningRole } from "@/lib/shared/planning";
import type { PlanningAssignmentView } from "@/lib/shared/planning-view";
import { rolesConflict, slotsOverlap } from "@/lib/shared/planning-planner";
import { MATCH_REFEREE_REFUSAL_CODES, holdingRefusal, lockedHolding, withPlanningLock, writeAssignment, writeEvent } from "./auto-assign";
import {
  loadPlanningData,
  loadPlanningEntries,
  loadPlanningMembersByIds,
  parseEntryKey,
  type Executor,
  type LoadedEntry,
  type PlanningData,
} from "./load";
import { entryAssignments } from "./model";
import { announceAssignments } from "./notices";
import { readMatchReferee, settleFailedDesignation, snapshotGesture, undoPlanningBlock } from "./planning-undo";
import { loadEntryPlayers, playersDuring } from "./players";
import { writeSoloCaster } from "./profiles";

/** Statut HTTP de chaque refus des gestes du planning (le reste est une panne). */
export const PLANNING_STATUSES: Readonly<Record<string, number>> = {
  PLANNING_ENTRY_NOT_FOUND: 404,
  PLANNING_ENTRY_CLOSED: 409,
  PLANNING_ROLE_NOT_HELD: 409,
  PLANNING_HIDDEN_FOR_MEMBER: 409,
  PLANNING_ROLE_CONFLICT: 409,
  PLANNING_CASTERS_FULL: 409,
  PLANNING_IS_PLAYER: 409,
  PLANNING_OVERLAP: 409,
  PLANNING_OVERLAP_MANAGED: 409,
  PLANNING_CAST_MANAGED: 409,
  PLANNING_NOT_ASSIGNED: 409,
  PLANNING_BUSY: 409,
  PLANNING_CONFIRM_PARTIAL: 409,
  PLANNING_WITHDRAWAL_CLOSED: 409,
  PLANNING_REASON_TOO_LONG: 400,
  NOT_CASTER: 409,
  // Refus de la désignation d'un arbitre de match (`assignMatchReferee`) : la liste unique.
  ...Object.fromEntries(MATCH_REFEREE_REFUSAL_CODES.map((code) => [code, code === "MATCH_NOT_FOUND" ? 404 : 409])),
};

function affectedRows(result: unknown): number {
  return Number((result as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

/** Une seule entrée, lue par sa clé : sans toute la fenêtre, ni les comptes, ni les disponibilités des autres. */
async function loadOneEntry(executor: Executor, user: AuthUser, entryKey: string, now: number): Promise<LoadedEntry> {
  const only = parseEntryKey(entryKey);
  const entries = only ? await loadPlanningEntries(executor, { now, includeHidden: can(user, "tournaments"), only }) : [];
  const entry = entries.find((candidate) => candidate.key === entryKey);
  if (!entry) throw new Error("PLANNING_ENTRY_NOT_FOUND");
  return entry;
}

async function findEntry(executor: Executor, user: AuthUser, entryKey: string, now: number) {
  const data = await loadPlanningData(executor, { now, includeHidden: can(user, "tournaments") });
  const entry = data.entries.find((candidate) => candidate.key === entryKey);
  if (!entry) throw new Error("PLANNING_ENTRY_NOT_FOUND");
  return { data, entry };
}

/**
 * Disponibilité du lecteur pour un rôle qu'il tient, sur une entrée encore
 * ouverte (à venir, non jouée). Un membre aux rôles multiples choisit, entrée
 * par entrée, pour quel(s) rôle(s) il se rend disponible.
 */
export async function setAvailability(
  user: AuthUser,
  input: { entryKey: string; role: PlanningRole; status: AvailabilityStatus; preferred: boolean },
  now: number = Date.now(),
): Promise<void> {
  if (!planningRolesOf(user).includes(input.role)) throw new Error("PLANNING_ROLE_NOT_HELD");
  await withConnection(async (connection) => {
    const entry = await loadOneEntry(connection, user, input.entryKey, now);
    if (!entry.open) throw new Error("PLANNING_ENTRY_CLOSED");
    await connection.execute(
      `INSERT INTO bg_planning_availability (entry_key, user_id, role, tournament_id, match_id, status, preferred)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), preferred = VALUES(preferred)`,
      [entry.key, user.id, input.role, entry.tournamentId, entry.matchId, input.status, input.preferred ? 1 : 0],
    );
  });
}

/**
 * Le réglage « caster autonome » d'un compte qui tient le rôle `CASTER`
 * (relu en base). Qui peut le poser — lui-même ou le staff — est jugé par la route.
 * Un compte suspendu n'a plus de droit effectif : son réglage ne se change pas
 * (`PLANNING_ROLE_NOT_HELD`, le refus d'une désignation à la main), sans que le
 * refus nomme la suspension.
 */
export async function setSoloCaster(targetUserId: number, solo: boolean): Promise<void> {
  await withConnection(async (connection) => {
    // Le seul compte visé, relu par sa clé : ses rôles du moment.
    const [member] = await loadPlanningMembersByIds(connection, [targetUserId]);
    if (!member?.roles.includes("CASTER")) {
      throw new Error("NOT_CASTER");
    }
    if (member.suspended) throw new Error("PLANNING_ROLE_NOT_HELD");
    await writeSoloCaster(connection, targetUserId, solo);
  });
}

function heldRolesOn(entry: LoadedEntry, data: PlanningData, userId: number): PlanningRole[] {
  return entryAssignments(entry, data)
    .filter((row) => row.userId === userId)
    .map((row) => row.role);
}

/**
 * Désignation à la main (permission `tournaments`, jugée par la route) :
 * `assigned: true` pose le membre dans le rôle, `false` l'en retire. Un choix
 * du staff n'est **jamais** remplacé par un calcul : la pose est `MANUAL`, et
 * un retrait écarte ce membre de ce rôle de cette entrée pour les calculs
 * suivants. L'arbitre d'un match passe par la désignation du match
 * (`assignMatchReferee` : condition d'arbitrage, joueur du match refusé).
 *
 * Les lignes du planning s'écrivent d'abord, d'un bloc (une transaction
 * validée, qui ne retient donc plus aucun verrou sur le match) ; la
 * désignation du match, qui a la sienne, passe ensuite. Si elle est refusée,
 * ou tombe en panne sans avoir pris, les lignes des entrées touchées sont
 * remises et les évènements du geste effacés (`planning-undo.ts`) : le match
 * ne se réécrit jamais à la main, planning et match ne se contredisent pas.
 */
type ManualInput = { entryKey: string; role: PlanningRole; userId: number; assigned: boolean };
type ManualContext = {
  connection: PoolConnection;
  actor: AuthUser;
  data: PlanningData;
  entry: LoadedEntry;
  input: ManualInput;
  current: PlanningAssignmentView | undefined;
  matchId: number | null;
};

/**
 * Un membre ne couvre pas une entrée pendant laquelle il joue (ce match, ce
 * tournoi entier, ou une entrée qui la chevauche), ni deux entrées qui se
 * chevauchent : une attribution tenue ailleurs refuse le geste — confirmée ou
 * choix du staff (`PLANNING_OVERLAP`, à retirer d'abord dans le planning),
 * caster inscrit ou arbitre désigné sur le match (`PLANNING_OVERLAP_MANAGED`,
 * à retirer depuis le match) ; une simple proposition provisoire ailleurs
 * cède la place au choix du staff (rendue).
 */
async function overlappingProposals(
  connection: Executor,
  data: PlanningData,
  entry: LoadedEntry,
  userId: number,
): Promise<{ entry: LoadedEntry; role: PlanningRole }[]> {
  const around = data.entries.filter((other) => other.key === entry.key || slotsOverlap(other, entry));
  if (playersDuring(entry, around, await loadEntryPlayers(connection, around)).has(userId)) {
    throw new Error("PLANNING_IS_PLAYER");
  }
  const proposals: { entry: LoadedEntry; role: PlanningRole }[] = [];
  for (const other of around) {
    if (other.key === entry.key) continue;
    for (const row of entryAssignments(other, data).filter((candidate) => candidate.userId === userId)) {
      if (row.source === "CAST" || row.source === "MATCH") throw new Error("PLANNING_OVERLAP_MANAGED");
      if (!row.provisional) throw new Error("PLANNING_OVERLAP");
      proposals.push({ entry: other, role: row.role });
    }
  }
  return proposals;
}

/** Les refus d'une pose à la main jugés sur la lecture du geste (rôle, conflit, cast inscrit, plafond de casters). */
function refuseManualPose({ data, entry, input, current }: Pick<ManualContext, "data" | "entry" | "input" | "current">): void {
  const member = data.members.find((candidate) => candidate.userId === input.userId);
  // Rôle tenu, et tournoi encore caché seulement pour qui le voit, comme pour le calcul (`excludeFromHidden`).
  const refusal = holdingRefusal(member, entry, input.role);
  if (refusal !== null) throw new Error(refusal);
  if (heldRolesOn(entry, data, input.userId).some((role) => rolesConflict(role, input.role))) {
    throw new Error("PLANNING_ROLE_CONFLICT");
  }
  if (current?.source === "CAST") throw new Error("PLANNING_CAST_MANAGED");
  if (input.role === "CASTER" && planningCastersFull(entryAssignments(entry, data), input.userId)) throw new Error("PLANNING_CASTERS_FULL");
}

async function assignManually({ connection, actor, data, entry, input, current, matchId }: ManualContext): Promise<void> {
  refuseManualPose({ data, entry, input, current });
  const released = await overlappingProposals(connection, data, entry, input.userId);
  // L'instantané ne sert qu'à l'arbitre d'un match (seul geste qui passe par le match) : les lignes que le geste retire.
  const releasedKeys = new Set(released.map((proposal) => `${proposal.entry.key}|${proposal.role}`));
  const undo =
    matchId === null
      ? undefined
      : await snapshotGesture(
          connection,
          [entry.key, ...released.map((proposal) => proposal.entry.key)],
          { entryKey: entry.key, userId: input.userId, role: input.role },
          (row) =>
            (row.entry_key === entry.key && row.role === "REFEREE" && Number(row.user_id) !== input.userId) ||
            (Number(row.user_id) === input.userId &&
              row.source === "AUTO" &&
              !Number(row.confirmed) &&
              releasedKeys.has(`${row.entry_key}|${row.role}`)),
        );
  // L'évènement du retrait de l'arbitre que le match portait seul : effacé si ce n'est finalement pas ce geste qui l'a retiré.
  let carriedEvent: number | undefined;
  const eventIds = await transact(connection, async () => {
    // Relu verrouillé, dans la transaction qui écrit : un rôle retiré ou un tournoi recaché entre-temps refuse le geste.
    const holds = await lockedHolding(connection, [{ userId: input.userId, entry }]);
    const fresh = holds(input.userId, entry, input.role);
    if (fresh !== null) throw new Error(fresh);
    // Chaque ligne que le geste retire s'inscrit à l'historique (`REMOVED`, `AUTO` : un retrait par
    // conséquence, qui n'écarte personne des calculs suivants), au compte du staff qui agit ;
    // ces évènements s'effacent avec le reste si la désignation du match est refusée.
    const ids: number[] = [];
    for (const proposal of released) {
      const [removed] = await connection.execute(
        "DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = ? AND source = 'AUTO' AND confirmed = 0",
        [proposal.entry.key, input.userId, proposal.role],
      );
      if (affectedRows(removed) > 0) ids.push(await writeEvent(connection, proposal.entry, input.userId, proposal.role, "REMOVED", "AUTO", actor.id));
    }
    if (matchId !== null) {
      // L'arbitre que le choix du staff remplace sur ce match (proposé ou confirmé), lu verrouillé avant d'être retiré.
      const [displaced] = await connection.execute<(RowDataPacket & { user_id: number })[]>(
        "SELECT user_id FROM bg_planning_assignments WHERE entry_key = ? AND role = 'REFEREE' AND user_id <> ? FOR UPDATE",
        [entry.key, input.userId],
      );
      await connection.execute("DELETE FROM bg_planning_assignments WHERE entry_key = ? AND role = 'REFEREE' AND user_id <> ?", [
        entry.key,
        input.userId,
      ]);
      for (const row of displaced) ids.push(await writeEvent(connection, entry, Number(row.user_id), "REFEREE", "REMOVED", "AUTO", actor.id));
      // L'arbitre posé depuis le match seul (sans ligne au planning) que ce choix remplace : son retrait
      // passe par le planning, il s'inscrit aussi (effacé avec le geste si le match le refuse). Le match
      // est relu ici, pas d'après la lecture d'avant la transaction : un arbitre changé entre-temps depuis
      // le match n'est pas mis au compte du staff (la désignation, qui attend l'ancien, est alors refusée).
      const carried = await readMatchRefereeIn(connection, matchId);
      if (carried !== null && carried !== input.userId && !displaced.some((row) => Number(row.user_id) === carried)) {
        carriedEvent = await writeEvent(connection, entry, carried, "REFEREE", "REMOVED", "AUTO", actor.id);
        ids.push(carriedEvent);
      }
    }
    ids.push(await writeAssignment(connection, entry, { userId: input.userId, role: input.role, source: "MANUAL", reason: "MANUAL" }, actor.id));
    return ids;
  });
  if (matchId === null || undo === undefined) return;
  // Le match porte déjà ce membre : rien à lui demander (et une panne n'aurait rien à trancher) ; s'il
  // l'a reçu depuis le match après la transaction, ce geste n'a retiré personne du match.
  if ((await readMatchReferee(matchId)) === input.userId) {
    if (carriedEvent !== undefined) await undoPlanningBlock({ keys: [], rows: [] }, [carriedEvent]);
    return;
  }
  try {
    // Suspension jugée dans la transaction même du match (`refuseSuspended`) : une suspension posée
    // depuis le contrôle du planning refuse, et le geste se défait comme sur un refus.
    await assignMatchReferee(matchId, actor.id, input.userId, entry.matchRefereeId, { refuseSuspended: true });
  } catch (error) {
    const took = await settleFailedDesignation(error, matchId, input.userId, undo, eventIds);
    // Issue incertaine : le match a pu garder son arbitre, l'historique ne dit pas qu'il l'a perdu.
    if (took === undefined && carriedEvent !== undefined) await undoPlanningBlock({ keys: [], rows: [] }, [carriedEvent]);
    // Même texte neutre que le contrôle du planning : la suspension n'est pas dite au staff des tournois.
    if (error instanceof Error && error.message === "REFEREE_UNAVAILABLE") throw new Error("PLANNING_ROLE_NOT_HELD");
    throw error;
  }
}

/** L'arbitre du match, lu dans la transaction du geste (lecture simple : aucun verrou de match sous celui du planning). */
async function readMatchRefereeIn(connection: Executor, matchId: number): Promise<number | null> {
  const [rows] = await connection.execute<(RowDataPacket & { referee_user_id: number | null })[]>(
    "SELECT m.referee_user_id FROM bg_matches m WHERE m.id = ?",
    [matchId],
  );
  const value = rows[0]?.referee_user_id;
  return value === null || value === undefined ? null : Number(value);
}

async function unassignManually({ connection, actor, entry, input, current, matchId }: ManualContext): Promise<void> {
  if (!current) throw new Error("PLANNING_NOT_ASSIGNED");
  // Un caster inscrit sur le match se retire depuis le match (inscription de cast).
  if (current.source === "CAST") throw new Error("PLANNING_CAST_MANAGED");
  // Une proposition provisoire n'est pas encore posée sur le match.
  const onMatch = matchId !== null && !current.provisional;
  const undo = onMatch ? await snapshotGesture(connection, [entry.key], { entryKey: entry.key, userId: input.userId, role: input.role }) : undefined;
  const eventIds = await transact(connection, async () => {
    await connection.execute("DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = ?", [
      entry.key,
      input.userId,
      input.role,
    ]);
    return [await writeEvent(connection, entry, input.userId, input.role, "REMOVED", "MANUAL", actor.id)];
  });
  if (matchId === null || undo === undefined) return;
  // Le match ne porte pas (ou plus) ce membre — plus d'arbitre, ou un autre posé depuis le match :
  // rien à lui demander, la ligne du planning n'était qu'un reste (la réconciliation l'aurait retirée).
  const carried = await readMatchReferee(matchId);
  if (carried !== undefined && carried !== input.userId) return;
  try {
    await assignMatchReferee(matchId, actor.id, null, input.userId);
  } catch (error) {
    await settleFailedDesignation(error, matchId, null, undo, eventIds);
    throw error;
  }
}

export async function setManualAssignment(actor: AuthUser, input: ManualInput, now: number = Date.now()): Promise<void> {
  const announce = await withPlanningLock(async (connection) => {
    const { data, entry } = await findEntry(connection, actor, input.entryKey, now);
    if (!entry.editable) throw new Error("PLANNING_ENTRY_CLOSED");
    // L'arbitre d'un match passe par le match lui-même.
    const matchId = entry.kind === "MATCH" && input.role === "REFEREE" ? entry.matchId : null;
    const current = entryAssignments(entry, data).find((row) => row.userId === input.userId && row.role === input.role);
    const context = { connection, actor, data, entry, input, current, matchId };
    await (input.assigned ? assignManually(context) : unassignManually(context));
    // Une affectation nouvelle (ou une proposition que ce choix fixe) s'annonce ; une déjà tenue, non.
    return input.assigned && (current === undefined || current.provisional) ? entry : null;
  });
  // Après le verrou, sans faire attendre la page ; l'auteur qui se pose lui-même n'est pas prévenu.
  if (announce !== null) void announceAssignments([{ userId: input.userId, entry: announce, role: input.role }], { actorId: actor.id });
}
