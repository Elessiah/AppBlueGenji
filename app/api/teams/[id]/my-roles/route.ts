import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { TEAM_OWN_ROLES_ERROR_STATUS, parseTeamId, teamErrorStatus } from "@/lib/server/team-route-errors";
import { rolesListFromBody } from "@/lib/server/team-invite-roles";
import { getTeamDetail } from "@/lib/server/teams/detail";
import { updateOwnGameRoles } from "@/lib/server/teams/roster";
import { readJsonBody } from "@/lib/server/request-body";

/**
 * « Mes rôles » : le membre connecté choisit ses propres rôles de jeu (`COACH`,
 * `TANK`, `DPS`, `HEAL` — décision D71). Corps `{ roles: string[] }`, liste
 * vide permise ; ses rôles de direction ne bougent pas (`updateOwnGameRoles`).
 * Rend la fiche relue, comme les autres gestes du roster.
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  try {
    const body = (await readJsonBody(req)) as { roles?: unknown };
    await updateOwnGameRoles(user.id, teamId, rolesListFromBody(body.roles));
    const detail = await getTeamDetail(teamId, user.id);
    return ok(detail);
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "TEAM_OWN_ROLES_FAILED", teamErrorStatus(TEAM_OWN_ROLES_ERROR_STATUS, message));
  }
}
