import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getTeamDetail, updateTeamMeta } from "@/lib/server/teams-service";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  const detail = await getTeamDetail(teamId, user.id);
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
    const body = (await req.json()) as { name?: string; logoUrl?: string | null };
    await updateTeamMeta(user.id, teamId, {
      name: body.name,
      logoUrl: body.logoUrl,
    });

    const detail = await getTeamDetail(teamId, user.id);
    return ok(detail);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    return fail(message || "TEAM_UPDATE_FAILED", 400);
  }
}
