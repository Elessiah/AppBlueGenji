import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { registerCurrentUserTeam } from "@/lib/server/tournaments-service";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  try {
    await registerCurrentUserTeam(tournamentId, user.id);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (
      message === "NO_ACTIVE_TEAM"
      || message === "REGISTRATION_CLOSED"
      || message === "TOURNAMENT_FULL"
      || message === "ALREADY_REGISTERED"
    ) {
      return fail(message, 400);
    }

    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
    return fail(message || "REGISTRATION_FAILED", 500);
  }
}
