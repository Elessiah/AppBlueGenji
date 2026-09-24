import type { TeamRole } from "@/lib/shared/types";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { TERMS_ACCEPTANCE_REQUIRED } from "@/lib/shared/terms-of-use";
import {
  getTeamDetail,
  inviteToTeam,
  removeTeamMember,
  updateTeamMemberRoles,
} from "@/lib/server/teams-service";
import { JOIN_CONFLICTS, inviteRolesFromBody } from "@/lib/server/team-invite-roles";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  try {
    const body = (await req.json()) as { pseudo?: string; roles?: unknown };
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
    if (message === "FORBIDDEN") return fail(message, 403);
    if (message === TERMS_ACCEPTANCE_REQUIRED) return fail(message, 409);
    if (message === "USER_NOT_FOUND") return fail(message, 404);
    if (message === "USER_ALREADY_IN_TEAM") return fail(message, 409);
    if (message === "ALREADY_INVITED") return fail(message, 409);
    if (message === "MISSING_ROLE") return fail(message, 400);
    if (JOIN_CONFLICTS.has(message)) return fail(message, 409);
    return fail(message || "TEAM_MEMBER_ADD_FAILED", 400);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  try {
    const body = (await req.json()) as { userId?: number; roles?: TeamRole[] };
    if (!body.userId || !Number.isInteger(body.userId)) {
      return fail("MISSING_USER_ID", 400);
    }

    await updateTeamMemberRoles(user.id, teamId, body.userId, body.roles ?? []);
    const detail = await getTeamDetail(teamId, user.id);
    return ok(detail);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    if (message === TERMS_ACCEPTANCE_REQUIRED) return fail(message, 409);
    if (message === "MEMBER_NOT_FOUND") return fail(message, 404);
    if (message === "MISSING_ROLE") return fail(message, 400);
    return fail(message || "TEAM_MEMBER_UPDATE_FAILED", 400);
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  try {
    const body = (await req.json()) as { userId?: number };
    if (!body.userId || !Number.isInteger(body.userId)) {
      return fail("MISSING_USER_ID", 400);
    }

    await removeTeamMember(user.id, teamId, body.userId);
    const detail = await getTeamDetail(teamId, user.id);
    return ok(detail);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    if (message === TERMS_ACCEPTANCE_REQUIRED) return fail(message, 409);
    if (message === "MEMBER_NOT_FOUND") return fail(message, 404);
    if (message === "OWNER_CANNOT_LEAVE") return fail(message, 400);
    if (message === "CANNOT_KICK_OWNER") return fail(message, 409);
    return fail(message || "TEAM_MEMBER_REMOVE_FAILED", 400);
  }
}
