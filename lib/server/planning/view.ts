/**
 * La page « Planning » (`GET /api/planning`) : entrées, attributions,
 * couverture, disponibilités du lecteur — et, pour le staff des tournois,
 * celles de tous.
 */
import type { AuthUser } from "@/lib/server/auth";
import { withConnection } from "@/lib/server/database";
import { can } from "@/lib/shared/permissions";
import { planningRolesOf } from "@/lib/shared/planning";
import type { PlanningEntryView, PlanningView } from "@/lib/shared/planning-view";
import {
  loadPlanningData,
  loadPlanningMembers,
  loadSoloCasterIds,
  type Executor,
  type LoadedAvailability,
  type LoadedMember,
} from "./load";
import { entryAssignments, entryCoverage } from "./model";

/**
 * Durée de la copie des comptes qui tiennent un rôle du planning (pseudo,
 * rôles) : la page les affiche, elle ne décide rien d'après eux — les gestes et
 * le calcul les relisent. Chaque chargement de page ne repasse donc pas sur
 * toute la table des comptes. Le réglage « caster autonome », lui, se relit à
 * chaque fois (une lecture de la petite table des profils) : un geste y est
 * visible aussitôt.
 */
export const PLANNING_MEMBERS_TTL_MS = 30 * 1000;

let membersCache: { at: number; members: LoadedMember[] } | null = null;

/** Oublie la copie des comptes (tests, et tout geste qui en change la liste). */
export function resetPlanningMembersCache(): void {
  membersCache = null;
}

async function pageMembers(connection: Executor, now: number): Promise<LoadedMember[]> {
  let base: LoadedMember[];
  if (membersCache && now >= membersCache.at && now - membersCache.at < PLANNING_MEMBERS_TTL_MS) {
    base = membersCache.members;
  } else {
    base = await loadPlanningMembers(connection);
    membersCache = { at: now, members: base };
  }
  const solo = await loadSoloCasterIds(connection);
  return base.map((member) => ({ ...member, soloCaster: solo.has(member.userId) }));
}

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
    loadPlanningData(connection, { now, includeHidden: canManage, members: await pageMembers(connection, now) }),
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
      assignments,
      coverage: entryCoverage(assignments, solo),
      mine: availability
        .filter((row) => row.userId === user.id)
        .map(({ userId, role, status, preferred }) => ({ userId, role, status, preferred })),
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
    members: data.members.map((member) => ({ ...member })),
    durations: data.durations,
  };
}
