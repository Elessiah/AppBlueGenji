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
import { loadDurationSettings, loadPlanningData } from "./load";
import { entryAssignments, entryCoverage } from "./model";

export async function loadPlanningView(user: AuthUser, now: number = Date.now()): Promise<PlanningView> {
  const canManage = can(user, "tournaments");
  const { data, durations } = await withConnection(async (connection) => ({
    data: await loadPlanningData(connection, { now, includeHidden: canManage }),
    durations: await loadDurationSettings(connection),
  }));
  const solo = new Set(data.members.filter((member) => member.soloCaster).map((member) => member.userId));
  const entries: PlanningEntryView[] = data.entries.map((entry) => {
    const assignments = entryAssignments(entry, data);
    const availability = data.availability.filter((row) => row.entryKey === entry.key);
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
    durations,
  };
}
