import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { forfeitSurvivalTeam } from "@/lib/server/tournaments-service";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { can } from "@/lib/shared/permissions";

/**
 * Déclare le forfait d'une équipe dans un tournoi « Survie ».
 * - Un membre déclare le forfait de son équipe active.
 * - Un arbitre/admin peut forcer le forfait de n'importe quelle équipe (`teamId`).
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_ID", 400);
  }

  const body = (await req.json().catch(() => ({}))) as { teamId?: number };
  const isReferee = can(user, "tournaments");

  let teamId: number | null = null;
  if (isReferee && body.teamId) {
    teamId = Number(body.teamId);
  } else {
    const activeTeam = await getUserActiveTeam(user.id);
    if (!activeTeam) return fail("NO_ACTIVE_TEAM", 400);
    teamId = activeTeam.teamId;
    // Un non-arbitre ne peut forfaiter que sa propre équipe.
    if (body.teamId && Number(body.teamId) !== teamId) {
      return fail("FORBIDDEN", 403);
    }
  }

  if (!Number.isInteger(teamId) || teamId <= 0) return fail("INVALID_TEAM", 400);

  try {
    await forfeitSurvivalTeam(tournamentId, teamId);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (
      message === "NOT_SURVIVAL" ||
      message === "TOURNAMENT_NOT_RUNNING" ||
      message === "TEAM_ALREADY_OUT"
    ) {
      return fail(message, 400);
    }
    if (message === "TEAM_NOT_IN_TOURNAMENT") return fail(message, 404);
    return fail(message || "FORFEIT_FAILED", 500);
  }
}
