import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, TOURNAMENT_READ_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { getViewerMatchProposals, getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";

/**
 * Propositions map par map en attente sur **un** match (`MAP_SCORES.md`) : la
 * relecture légère des dialogues de score quand une proposition est déposée
 * après la connexion au flux (`useProposalMaps`). Mêmes conditions que la
 * lecture REST du détail — une session, un tournoi visible —, et la même règle
 * de lecture que le contexte du lecteur : les deux engagés qui mènent le match,
 * et l'arbitrage. `proposals: null` : rien de lisible pour ce lecteur.
 */
export async function GET(_: Request, context: { params: Promise<{ id: string; matchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(TOURNAMENT_READ_RULE, user.id);
  if (throttled) return throttled;

  const { id, matchId: rawMatchId } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }
  const matchId = Number(rawMatchId);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return fail("INVALID_MATCH_ID", 400);
  }

  const canManage = can(user, "tournaments");
  // La carte seule, même règle de visibilité : l'instantané entier se
  // rebâtirait à chaque relecture sur un cache vidé par les scores.
  const card = await getVisibleTournamentCard(tournamentId, { canManage });
  if (!card) return fail("TOURNAMENT_NOT_FOUND", 404);

  return ok({ proposals: await getViewerMatchProposals({ card }, user.id, canManage, matchId) });
}
