import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, MATCH_PROPOSALS_READ_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { isContentionError } from "@/lib/server/mysql-errors";
import { CONCURRENT_UPDATE_RETRY } from "@/lib/shared/api-error-code";
import { getViewerMatchProposals } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
import { failureReason } from "@/lib/server/failure-reason";

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

  const throttled = enforceRateLimit(MATCH_PROPOSALS_READ_RULE, user.id);
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

  // Visibilité du tournoi relue sur sa seule ligne, dans la même connexion que
  // le match : ni l'instantané (rebâti à chaque relecture sur un cache vidé par
  // les scores), ni l'agrégat des inscrites de la carte.
  // Une panne de la lecture (pool épuisé, verrou venu trop tard…) rend un code
  // seul, jamais le 500 nu de Next : `CONCURRENT_UPDATE_RETRY` en 409 pour une
  // contention, reconnue par le code de l'erreur (un message localisé,
  // `lc_messages`, ne s'y lit pas), `INTERNAL_ERROR` sinon (`fail()`).
  try {
    const read = await getViewerMatchProposals(tournamentId, user.id, can(user, "tournaments"), matchId);
    if (!read.visible) return fail("TOURNAMENT_NOT_FOUND", 404);

    return ok({ proposals: read.proposals });
  } catch (error) {
    if (isContentionError(error)) {
      console.warn(`[tournaments] propositions du match ${matchId} : lecture en contention, rendue en ${CONCURRENT_UPDATE_RETRY} :`, failureReason(error));
      return fail(CONCURRENT_UPDATE_RETRY, 409);
    }
    return fail(error instanceof Error ? error.message : "INTERNAL_ERROR", 500);
  }
}
