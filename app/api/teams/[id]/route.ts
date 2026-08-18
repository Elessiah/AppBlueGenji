import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getTeamDetail, softDeleteTeam, updateTeamMeta } from "@/lib/server/teams-service";
import { can } from "@/lib/shared/permissions";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  const detail = await getTeamDetail(teamId, user.id, can(user, "tournaments"));
  if (!detail) return fail("TEAM_NOT_FOUND", 404);

  return ok(detail);
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
    const body = (await req.json()) as { name?: string; description?: string | null };
    const managesGhostTeams = can(user, "tournaments");
    await updateTeamMeta(
      user.id,
      teamId,
      { name: body.name, description: body.description },
      managesGhostTeams,
    );

    const detail = await getTeamDetail(teamId, user.id, managesGhostTeams);
    return ok(detail);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    return fail(message || "TEAM_UPDATE_FAILED", 400);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  try {
    await softDeleteTeam(user.id, teamId, can(user, "tournaments"));
    return ok({ deleted: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    if (message === "TEAM_ALREADY_DELETED") return fail(message, 409);
    return fail(message || "TEAM_DELETE_FAILED", 400);
  }
}
