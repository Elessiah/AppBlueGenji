/**
 * La page « Planning » (`GET /api/planning`) : entrées, attributions,
 * couverture, disponibilités du lecteur — et, pour le staff des tournois,
 * celles de tous.
 */
import type { AuthUser } from "@/lib/server/auth";
import { withConnection } from "@/lib/server/database";
import { can } from "@/lib/shared/permissions";
import { PLANNING_ROLES, planningRolesOf, type PlanningRole } from "@/lib/shared/planning";
import type { PlanningAssignmentShown, PlanningAssignmentView, PlanningEntryView, PlanningView } from "@/lib/shared/planning-view";
import {
  loadPlanningData,
  loadPlanningMembers,
  coveringSoloCasterIds,
  loadPlanningMembersByIds,
  type Executor,
  type LoadedEntry,
  type LoadedMember,
  type LoadedWithdrawal,
} from "./load";
import { entryAssignments, entryCoverage } from "./model";

/**
 * Durée de la copie de la **liste** des comptes qui tiennent un rôle du
 * planning : elle évite de repasser, à chaque chargement de page, sur toute la
 * table des comptes (les rôles se cherchent dans du JSON). Seuls les
 * identifiants en sont gardés : à chaque page, ces comptes se relisent par
 * leur clé (pseudo, rôles, réglage « caster autonome »), et un compte supprimé
 * ou qui a perdu son rôle n'est plus rendu, dès le chargement suivant. Un
 * rôle **accordé** apparaît, lui, au plus tard au bout de ce délai.
 */
export const PLANNING_MEMBERS_TTL_MS = 30 * 1000;

let membersCache: { at: number; ids: number[] } | null = null;

/** Oublie la copie de la liste des comptes (tests). */
export function resetPlanningMembersCache(): void {
  membersCache = null;
}

async function pageMembers(connection: Executor, now: number): Promise<LoadedMember[]> {
  if (membersCache && now >= membersCache.at && now - membersCache.at < PLANNING_MEMBERS_TTL_MS) {
    return loadPlanningMembersByIds(connection, membersCache.ids);
  }
  const members = await loadPlanningMembers(connection);
  membersCache = { at: now, ids: members.map((member) => member.userId) };
  return members;
}

/**
 * Ce qu'une attribution dit de sa raison. « Préférence » et « Charge » disent
 * ce que la personne a demandé (ou non) : seuls le staff des tournois et la
 * personne elle-même le lisent ; pour les autres, une proposition du calcul
 * est « Calcul », sans plus.
 */
export function visibleAssignment(row: PlanningAssignmentView, readerId: number, canManage: boolean): PlanningAssignmentShown {
  if (canManage || row.userId === readerId) return row;
  // Liste blanche : un motif ajouté plus tard reste masqué tant qu'il n'y est pas.
  return SHARED_REASONS.has(row.reason) ? row : { ...row, reason: "AUTO" };
}

/** Motifs qui ne disent rien de ce que la personne a déclaré : lisibles de tous. */
const SHARED_REASONS: ReadonlySet<PlanningAssignmentView["reason"]> = new Set<PlanningAssignmentView["reason"]>(["MANUAL", "CAST", "MATCH"]);

/**
 * Rôles « à pourvoir » d'une entrée encore modifiable : un désistement d'une
 * attribution **confirmée** sur ce rôle, et plus personne qui le tienne
 * (proposition provisoire non comprise).
 */
export function unfilledRoles(
  entry: Pick<LoadedEntry, "editable">,
  assignments: readonly PlanningAssignmentView[],
  withdrawals: readonly LoadedWithdrawal[],
): PlanningRole[] {
  if (!entry.editable) return [];
  const roles = new Set(withdrawals.filter((row) => row.confirmed).map((row) => row.role));
  return PLANNING_ROLES.filter((role) => roles.has(role) && !assignments.some((row) => row.role === role && !row.provisional));
}

/** Les lignes regroupées par entrée, en un seul passage. */
function groupByEntry<T extends { entryKey: string }>(rows: readonly T[]): Map<string, T[]> {
  const byEntry = new Map<string, T[]>();
  for (const row of rows) {
    const list = byEntry.get(row.entryKey);
    if (list) list.push(row);
    else byEntry.set(row.entryKey, [row]);
  }
  return byEntry;
}

export async function loadPlanningView(user: AuthUser, now: number = Date.now()): Promise<PlanningView> {
  const canManage = can(user, "tournaments");
  const data = await withConnection(async (connection) =>
    loadPlanningData(connection, {
      now,
      includeHidden: canManage,
      members: await pageMembers(connection, now),
      ...(canManage ? {} : { availabilityOf: user.id }),
    }),
  );
  // Un caster autonome suspendu ne couvre plus seul son créneau aux yeux du staff, comme pour le calcul
  // (`preparePlanner`) ; les autres lecteurs gardent la couverture d'avant (rien n'y trahit la suspension).
  const solo = coveringSoloCasterIds(data.members, canManage);
  // Pour le staff seul, un compte suspendu ne tient pas une place quittée : elle se montre « à pourvoir », comme
  // l'alerte qu'il a reçue (`staffUnfilled`) ; les autres lecteurs ne lisent rien de la suspension.
  const suspended = new Set(canManage ? data.members.filter((member) => member.suspended).map((member) => member.userId) : []);
  const availabilityByEntry = groupByEntry(data.availability);
  const withdrawalsByEntry = groupByEntry(data.withdrawals);
  const entries: PlanningEntryView[] = data.entries.map((entry) => {
    const assignments = entryAssignments(entry, data);
    const availability = availabilityByEntry.get(entry.key) ?? [];
    return {
      key: entry.key,
      kind: entry.kind,
      tournamentId: entry.tournamentId,
      tournamentName: entry.tournamentName,
      game: entry.game,
      matchId: entry.matchId,
      roundNumber: entry.roundNumber,
      team1: entry.team1,
      team2: entry.team2,
      startAt: new Date(entry.startAt).toISOString(),
      endAt: new Date(entry.endAt).toISOString(),
      open: entry.open,
      editable: entry.editable,
      hidden: entry.hidden,
      channelUrl: entry.channelUrl,
      selfManaged: entry.selfManaged,
      assignments: assignments.map((row) => visibleAssignment(row, user.id, canManage)),
      coverage: entryCoverage(assignments, solo),
      mine: availability
        .filter((row) => row.userId === user.id)
        .map(({ userId, role, status, preferred }) => ({ userId, role, status, preferred })),
      // Défense en profondeur : sans `tournaments`, la lecture ne rend déjà que les siennes.
      availability: canManage
        ? availability.map(({ userId, role, status, preferred }) => ({ userId, role, status, preferred }))
        : [],
      unfilled: unfilledRoles(entry, canManage ? assignments.filter((row) => !suspended.has(row.userId)) : assignments, withdrawalsByEntry.get(entry.key) ?? []),
      // Motif et auteur d'un désistement : au staff des tournois seul.
      withdrawals: canManage
        ? (withdrawalsByEntry.get(entry.key) ?? []).map(({ userId, role, late, reason, confirmed, createdAt }) => ({
            userId,
            role,
            late,
            reason,
            confirmed,
            createdAt,
          }))
        : [],
    };
  });
  return {
    me: user.id,
    myRoles: planningRolesOf(user),
    canManage,
    entries,
    // Champs nommés : ce que la page montre, rien de plus (`seesHidden` au staff seul, qui choisit les candidats).
    members: data.members.map(({ userId, pseudo, roles, soloCaster, seesHidden }) =>
      canManage ? { userId, pseudo, roles, soloCaster, seesHidden } : { userId, pseudo, roles, soloCaster },
    ),
    durations: data.durations,
  };
}
