import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import {
  getTeamDetail,
  inviteToTeam,
  listTeamJoinRequests,
  listTeamSentInvitations,
} from "@/lib/server/teams-service";
import { inviteRolesFromBody } from "@/lib/server/team-invite-roles";

/**
 * Ce qui attend une réponse, vue gestion : les demandes (REQUEST) reçues et
 * les invitations (INVITE) envoyées.
 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) return fail("INVALID_TEAM_ID", 400);

  try {
    const [requests, invitations] = await Promise.all([
      listTeamJoinRequests(teamId, user.id),
      listTeamSentInvitations(teamId, user.id),
    ]);
    return ok({ requests, invitations });
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
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) return fail("INVALID_TEAM_ID", 400);

  try {
    const body = (await req.json()) as { pseudo?: string; roles?: unknown };
    if (!body.pseudo?.trim()) return fail("MISSING_PSEUDO", 400);

    const result = await inviteToTeam(user.id, teamId, body.pseudo.trim(), inviteRolesFromBody(body.roles));
    const detail = await getTeamDetail(teamId, user.id);
    return ok({ result, ...detail });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    if (message === "USER_NOT_FOUND") return fail(message, 404);
    if (message === "USER_ALREADY_IN_TEAM") return fail(message, 409);
    if (message === "ALREADY_INVITED") return fail(message, 409);
    if (message === "MISSING_ROLE") return fail(message, 400);
    return fail(message || "TEAM_INVITE_FAILED", 400);
  }
}
