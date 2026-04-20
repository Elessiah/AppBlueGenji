import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getTournamentDetail } from "@/lib/server/tournaments-service";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const detail = await getTournamentDetail(tournamentId, user.id);
  if (!detail) return fail("TOURNAMENT_NOT_FOUND", 404);

  return ok(detail);
}
