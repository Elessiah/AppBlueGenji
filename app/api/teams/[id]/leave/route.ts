import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { leaveTeam } from "@/lib/server/teams-service";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  try {
    await leaveTeam(user.id, teamId);
    return ok({ left: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "NOT_A_MEMBER") return fail(message, 404);
    if (message === "OWNER_MUST_TRANSFER") return fail(message, 400);
    return fail(message || "TEAM_LEAVE_FAILED", 400);
  }
}
