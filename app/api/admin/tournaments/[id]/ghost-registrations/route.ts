import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { listGhostTeams } from "@/lib/server/ghost-teams-service";
import { isGhostTeam } from "@/lib/server/teams-service";
import { registerGhostTeam } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";

/** Équipes fantômes disponibles pour un ajout au tournoi. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  return ok({ teams: await listGhostTeams() });
}

/**
 * Inscrit une équipe fantôme au tournoi, sans passer par le flux joueur.
 * Volontairement limité aux équipes fantômes : le staff n'inscrit jamais
 * l'équipe d'un joueur réel à sa place.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const body = (await req.json().catch(() => ({}))) as { teamId?: unknown };
  const teamId = Number(body.teamId);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  if (!(await isGhostTeam(teamId))) {
    return fail("NOT_A_GHOST_TEAM", 409);
  }

  try {
    await registerGhostTeam(tournamentId, teamId);
    return ok({ success: true }, 201);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TOURNAMENT_NOT_FOUND" || message === "TEAM_NOT_FOUND") return fail(message, 404);
    if (
      message === "REGISTRATION_CLOSED"
      || message === "TOURNAMENT_FULL"
      || message === "ALREADY_REGISTERED"
      || message === "TEAM_ALREADY_DELETED"
    ) {
      return fail(message, 409);
    }
    return fail(message || "GHOST_REGISTRATION_FAILED", 500);
  }
}
