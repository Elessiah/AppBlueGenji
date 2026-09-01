import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { forfeitTournamentTeam, getUserEntrantTeamId } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";

/**
 * Déclare le forfait d'un engagé dans un tournoi « Survie » ou « Ronde suisse »
 * — les formats où l'on reste en lice sans être éliminé par une défaite.
 * - Un joueur déclare le forfait de son engagé : son équipe active, ou lui-même
 *   si le tournoi est individuel.
 * - Un arbitre/admin peut forcer le forfait de n'importe quel engagé (`teamId`).
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const body = (await req.json().catch(() => ({}))) as { teamId?: number };
  const isReferee = can(user, "tournaments");

  let teamId: number | null = null;
  if (isReferee && body.teamId) {
    teamId = Number(body.teamId);
  } else {
    let entrantTeamId: number | null;
    try {
      entrantTeamId = await getUserEntrantTeamId(tournamentId, user.id);
    } catch (error) {
      // Tournoi inconnu : ne pas le maquiller en problème d'équipe.
      if ((error as Error).message === "TOURNAMENT_NOT_FOUND") {
        return fail("TOURNAMENT_NOT_FOUND", 404);
      }
      throw error;
    }
    if (entrantTeamId === null) return fail("NO_ACTIVE_TEAM", 400);
    teamId = entrantTeamId;
    // Un non-arbitre ne peut forfaiter que son propre engagé.
    if (body.teamId && Number(body.teamId) !== teamId) {
      return fail("FORBIDDEN", 403);
    }
  }

  if (!Number.isInteger(teamId) || teamId <= 0) return fail("INVALID_TEAM", 400);

  try {
    await forfeitTournamentTeam(tournamentId, teamId);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (
      message === "NOT_SURVIVAL" ||
      message === "NOT_SWISS" ||
      message === "NOT_BG_SURVIE" ||
      message === "ENDURANCE_PLAYOFFS_STARTED" ||
      message === "FORMAT_WITHOUT_FORFEIT" ||
      message === "TOURNAMENT_NOT_RUNNING" ||
      message === "TEAM_ALREADY_OUT"
    ) {
      return fail(message, 400);
    }
    if (message === "TEAM_NOT_IN_TOURNAMENT") return fail(message, 404);
    return fail(message || "FORFEIT_FAILED", 500);
  }
}
