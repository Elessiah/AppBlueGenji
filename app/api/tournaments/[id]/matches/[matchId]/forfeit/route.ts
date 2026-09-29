import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { canActOnTournament } from "@/lib/server/tournaments/write-visibility";
import { forfeitOwnMatch } from "@/lib/server/tournaments-service";

/**
 * Forfait d'un engagé sur **sa** manche (`lib/server/tournaments/player-forfeit.ts`).
 *
 * Sans corps : l'équipe qui déclare forfait est celle du joueur connecté, et
 * jamais une autre — la route n'a donc rien à lire que la requête pourrait
 * falsifier. L'arbitrage garde son propre chemin (`POST .../resolve`).
 */
export async function POST(_req: Request, context: { params: Promise<{ id: string; matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id, matchId: rawMatchId } = await context.params;
  const tournamentId = Number(id);
  const matchId = Number(rawMatchId);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return fail("INVALID_MATCH_ID", 400);
  }

  // Tournoi non publié : même 404 qu'un identifiant inexistant, avant tout
  // autre refus (`write-visibility.ts`).
  if (!(await canActOnTournament(tournamentId, user))) return fail("TOURNAMENT_NOT_FOUND", 404);

  try {
    await forfeitOwnMatch(tournamentId, matchId, user.id);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (
      message === "NO_ACTIVE_TEAM" ||
      message === "TOURNAMENT_NOT_RUNNING" ||
      message === "MATCH_NOT_READY" ||
      message === "NOT_IN_MATCH"
    ) {
      return fail(message, 400);
    }
    // Même refus et même code que l'inscription et l'abandon : perdre une
    // manche sans la jouer engage l'équipe entière.
    if (message === "NOT_TEAM_MANAGER") return fail(message, 403);
    // Le match est bien formé, c'est son état qui refuse : déjà tranché
    // (l'adversaire vient de confirmer, l'arbitrage vient de trancher).
    if (
      message === "MATCH_ALREADY_COMPLETED" ||
      message === "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES"
    ) {
      return fail(message, 409);
    }
    if (message === "TOURNAMENT_NOT_FOUND" || message === "MATCH_NOT_FOUND") {
      return fail(message, 404);
    }
    return fail(message || "MATCH_FORFEIT_FAILED", 500);
  }
}
