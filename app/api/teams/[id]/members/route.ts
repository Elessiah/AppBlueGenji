import type { TeamRole } from "@/lib/shared/types";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { TEAM_INVITE_ERROR_STATUS, TEAM_MEMBER_REMOVE_ERROR_STATUS, TEAM_MEMBER_ROLES_ERROR_STATUS, parseTeamId, teamErrorStatus } from "@/lib/server/team-route-errors";
import { getTeamDetail } from "@/lib/server/teams/detail";
import { inviteToTeam } from "@/lib/server/teams/invitations";
import { removeTeamMember, updateTeamMemberRoles } from "@/lib/server/teams/roster";
import { inviteRolesFromBody } from "@/lib/server/team-invite-roles";
import { readJsonBody } from "@/lib/server/request-body";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  try {
    const body = (await readJsonBody(req)) as { pseudo?: string; roles?: unknown };
    if (!body.pseudo?.trim()) {
      return fail("MISSING_PSEUDO", 400);
    }

    // Invitation plutôt qu'ajout forcé : le joueur doit accepter (ou sa demande
    // en attente est validée directement → "JOINED"). Les rôles choisis
    // voyagent avec l'invitation : le formulaire les demandait, la route les
    // jetait, et le joueur arrivait toujours en DPS.
    const result = await inviteToTeam(user.id, teamId, body.pseudo.trim(), inviteRolesFromBody(body.roles));
    const detail = await getTeamDetail(teamId, user.id);
    return ok({ result, ...detail });
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "TEAM_MEMBER_ADD_FAILED", teamErrorStatus(TEAM_INVITE_ERROR_STATUS, message));
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  try {
    const body = (await readJsonBody(req)) as { userId?: number; roles?: TeamRole[] };
    if (!body.userId || !Number.isInteger(body.userId)) {
      return fail("MISSING_USER_ID", 400);
    }

    await updateTeamMemberRoles(user.id, teamId, body.userId, body.roles ?? []);
    const detail = await getTeamDetail(teamId, user.id);
    return ok(detail);
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "TEAM_MEMBER_UPDATE_FAILED", teamErrorStatus(TEAM_MEMBER_ROLES_ERROR_STATUS, message));
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  try {
    const body = (await readJsonBody(req)) as { userId?: number };
    if (!body.userId || !Number.isInteger(body.userId)) {
      return fail("MISSING_USER_ID", 400);
    }

    await removeTeamMember(user.id, teamId, body.userId);
    const detail = await getTeamDetail(teamId, user.id);
    return ok(detail);
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "TEAM_MEMBER_REMOVE_FAILED", teamErrorStatus(TEAM_MEMBER_REMOVE_ERROR_STATUS, message));
  }
}
