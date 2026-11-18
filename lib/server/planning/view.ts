/**
 * La page « Planning » (`GET /api/planning`) : entrées, attributions,
 * couverture, disponibilités du lecteur — et, pour le staff des tournois,
 * celles de tous.
 */
import type { AuthUser } from "@/lib/server/auth";
import { withConnection } from "@/lib/server/database";
import { can } from "@/lib/shared/permissions";
import { planningRolesOf } from "@/lib/shared/planning";
import type { PlanningAssignmentShown, PlanningAssignmentView, PlanningEntryView, PlanningView } from "@/lib/shared/planning-view";
import {
  loadPlanningData,
  loadPlanningMembers,
  loadPlanningMembersByIds,
  type Executor,
  type LoadedAvailability,
  type LoadedMember,
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

/** Les disponibilités regroupées par entrée, en un seul passage. */
function groupAvailability(rows: readonly LoadedAvailability[]): Map<string, LoadedAvailability[]> {
  const byEntry = new Map<string, LoadedAvailability[]>();
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
  const solo = new Set(data.members.filter((member) => member.soloCaster).map((member) => member.userId));
  const availabilityByEntry = groupAvailability(data.availability);
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
