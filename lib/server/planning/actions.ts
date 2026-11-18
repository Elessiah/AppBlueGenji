/**
 * Gestes du planning (`docs/features/CAST_PLANNING.md`) : sa disponibilité,
 * le réglage « caster autonome », la désignation à la main par le staff.
 * Chaque geste relit l'entrée en base ; une erreur se lève par son **code**,
 * que la route traduit (`PLANNING_STATUSES`).
 */
import type { PoolConnection } from "mysql2/promise";
import type { AuthUser } from "@/lib/server/auth";
import { withConnection } from "@/lib/server/database";
import { assignMatchReferee } from "@/lib/server/tournaments/match-launch";
import { transact } from "@/lib/server/tournaments/transaction";
import { can } from "@/lib/shared/permissions";
import { planningRolesOf, type AvailabilityStatus, type PlanningRole } from "@/lib/shared/planning";
import type { PlanningAssignmentView } from "@/lib/shared/planning-view";
import { rolesConflict, slotsOverlap } from "@/lib/shared/planning-planner";
import { MATCH_REFEREE_REFUSAL_CODES, withPlanningLock, writeAssignment, writeEvent } from "./auto-assign";
import { loadPlanningData, loadPlanningMembers, type Executor, type LoadedEntry, type PlanningData } from "./load";
import { readMatchReferee, restoreMatchReferee, type MatchRefereeSnapshot } from "./match-restore";
import { entryAssignments } from "./model";
import { loadEntryPlayers, playersDuring } from "./players";
import { writeSoloCaster } from "./profiles";

/** Statut HTTP de chaque refus des gestes du planning (le reste est une panne). */
export const PLANNING_STATUSES: Readonly<Record<string, number>> = {
  PLANNING_ENTRY_NOT_FOUND: 404,
  PLANNING_ENTRY_CLOSED: 409,
  PLANNING_ROLE_NOT_HELD: 409,
  PLANNING_ROLE_CONFLICT: 409,
  PLANNING_IS_PLAYER: 409,
  PLANNING_OVERLAP: 409,
  PLANNING_OVERLAP_MANAGED: 409,
  PLANNING_CAST_MANAGED: 409,
  PLANNING_NOT_ASSIGNED: 409,
  PLANNING_BUSY: 409,
  NOT_CASTER: 409,
  // Refus de la désignation d'un arbitre de match (`assignMatchReferee`) : la liste unique.
  ...Object.fromEntries(MATCH_REFEREE_REFUSAL_CODES.map((code) => [code, code === "MATCH_NOT_FOUND" ? 404 : 409])),
};

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
    const { entry } = await findEntry(connection, user, input.entryKey, now);
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
 */
export async function setSoloCaster(targetUserId: number, solo: boolean): Promise<void> {
  await withConnection(async (connection) => {
    const members = await loadPlanningMembers(connection);
    if (!members.some((member) => member.userId === targetUserId && member.roles.includes("CASTER"))) {
      throw new Error("NOT_CASTER");
    }
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
 * Les lignes du planning s'écrivent d'un bloc (une transaction) ; la
 * désignation du match, qui a la sienne, s'y fait **avant** toute ligne qui
 * nomme le match (la clé étrangère d'une ligne y prend un verrou partagé sur
 * le match, que la désignation attendrait). Si le bloc échoue après elle,
 * l'arbitrage d'avant — arbitre, autogestion, « prêt » — est remis sur le
 * match (`match-restore.ts`) : planning et match ne se contredisent pas.
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

async function assignManually({ connection, actor, data, entry, input, current, matchId }: ManualContext): Promise<void> {
  const member = data.members.find((candidate) => candidate.userId === input.userId);
  if (!member?.roles.includes(input.role)) throw new Error("PLANNING_ROLE_NOT_HELD");
  if (heldRolesOn(entry, data, input.userId).some((role) => rolesConflict(role, input.role))) {
    throw new Error("PLANNING_ROLE_CONFLICT");
  }
  if (current?.source === "CAST") throw new Error("PLANNING_CAST_MANAGED");
  const released = await overlappingProposals(connection, data, entry, input.userId);
  const before = matchId === null ? null : await readMatchReferee(connection, matchId);
  try {
    await transact(connection, async () => {
      for (const proposal of released) {
        await connection.execute(
          "DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = ? AND source = 'AUTO' AND confirmed = 0",
          [proposal.entry.key, input.userId, proposal.role],
        );
      }
      if (matchId !== null) {
        await connection.execute(
          "DELETE FROM bg_planning_assignments WHERE entry_key = ? AND role = 'REFEREE' AND user_id <> ?",
          [entry.key, input.userId],
        );
        await assignMatchReferee(matchId, actor.id, input.userId, entry.matchRefereeId);
      }
      await writeAssignment(connection, entry, { userId: input.userId, role: input.role, source: "MANUAL", reason: "MANUAL" }, actor.id);
    });
  } catch (error) {
    await undoMatchChange(before, input.userId);
    throw error;
  }
}

/**
 * Le bloc du planning a échoué : l'arbitrage du match est remis tel qu'il
 * était (`restoreMatchReferee`) — que la désignation ait été validée avant
 * l'échec, ou validée puis suivie d'une exception. Sans effet si elle n'avait
 * rien validé.
 */
async function undoMatchChange(before: MatchRefereeSnapshot | null, written: number | null): Promise<void> {
  if (before) await restoreMatchReferee(before, written);
}

async function unassignManually({ connection, actor, entry, input, current, matchId }: ManualContext): Promise<void> {
  if (!current) throw new Error("PLANNING_NOT_ASSIGNED");
  // Un caster inscrit sur le match se retire depuis le match (inscription de cast).
  if (current.source === "CAST") throw new Error("PLANNING_CAST_MANAGED");
  // Une proposition provisoire n'est pas encore posée sur le match.
  const onMatch = matchId !== null && !current.provisional;
  const before = onMatch && matchId !== null ? await readMatchReferee(connection, matchId) : null;
  try {
    await transact(connection, async () => {
      await connection.execute("DELETE FROM bg_planning_assignments WHERE entry_key = ? AND user_id = ? AND role = ?", [
        entry.key,
        input.userId,
        input.role,
      ]);
      if (onMatch && matchId !== null) {
        await assignMatchReferee(matchId, actor.id, null, input.userId);
      }
      await writeEvent(connection, entry, input.userId, input.role, "REMOVED", "MANUAL", actor.id);
    });
  } catch (error) {
    await undoMatchChange(before, null);
    throw error;
  }
}

export async function setManualAssignment(actor: AuthUser, input: ManualInput, now: number = Date.now()): Promise<void> {
  await withPlanningLock(async (connection) => {
    const { data, entry } = await findEntry(connection, actor, input.entryKey, now);
    if (!entry.editable) throw new Error("PLANNING_ENTRY_CLOSED");
    // L'arbitre d'un match passe par le match lui-même.
    const matchId = entry.kind === "MATCH" && input.role === "REFEREE" ? entry.matchId : null;
    const current = entryAssignments(entry, data).find((row) => row.userId === input.userId && row.role === input.role);
    const context = { connection, actor, data, entry, input, current, matchId };
    await (input.assigned ? assignManually(context) : unassignManually(context));
  });
}
