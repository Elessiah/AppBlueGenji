import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getTeamDetail, transferTeamOwnership } from "@/lib/server/teams-service";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  try {
    const body = (await req.json()) as { newOwnerUserId?: number };
    if (!body.newOwnerUserId || !Number.isInteger(body.newOwnerUserId)) {
      return fail("MISSING_USER_ID", 400);
    }

    await transferTeamOwnership(user.id, teamId, body.newOwnerUserId);
    const detail = await getTeamDetail(teamId, user.id);
    return ok(detail);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    if (message === "MEMBER_NOT_FOUND") return fail(message, 404);
    if (message === "TRANSFER_TO_SELF") return fail(message, 400);
    return fail(message || "TEAM_OWNERSHIP_TRANSFER_FAILED", 400);
  }
}
