import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { TEAM_INVITE_ERROR_STATUS, parseTeamId, teamErrorStatus } from "@/lib/server/team-route-errors";
import { getTeamDetail, inviteToTeam, listTeamPendingInvitations } from "@/lib/server/teams-service";
import { inviteRolesFromBody } from "@/lib/server/team-invite-roles";
import { readJsonBody } from "@/lib/server/request-body";
import { can } from "@/lib/shared/permissions";

/**
 * Ce qui attend une réponse, vue gestion : les demandes (REQUEST) reçues et
 * les invitations (INVITE) envoyées.
 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  try {
    return ok(await listTeamPendingInvitations(teamId, user.id, can(user, "tournaments")));
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    return fail(message || "INVITATIONS_LOAD_FAILED", 400);
  }
}

/** La gestion invite un joueur par pseudo. */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  try {
    const body = (await readJsonBody(req)) as { pseudo?: string; roles?: unknown };
    if (!body.pseudo?.trim()) return fail("MISSING_PSEUDO", 400);

    const result = await inviteToTeam(user.id, teamId, body.pseudo.trim(), inviteRolesFromBody(body.roles));
    const detail = await getTeamDetail(teamId, user.id);
    return ok({ result, ...detail });
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "TEAM_INVITE_FAILED", teamErrorStatus(TEAM_INVITE_ERROR_STATUS, message));
  }
}
