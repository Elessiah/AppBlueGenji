import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, TOURNAMENT_READ_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { listMyActiveTournamentIds } from "@/lib/server/tournaments/my-tournaments";

/**
 * Identifiants des tournois en cours ou à venir où le joueur connecté est
 * engagé. La liste publique de `/tournois` est la même pour tous (et
 * mutualisée) : c'est cette seconde lecture, courte, qui lui permet de mettre
 * « Mes tournois » en tête sans rendre la liste propre à chaque lecteur.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(TOURNAMENT_READ_RULE, user.id);
  if (throttled) return throttled;

  try {
    const tournamentIds = await listMyActiveTournamentIds(user.id);
    return ok({ tournamentIds });
  } catch (error) {
    console.error("[tournaments] lecture de mes tournois impossible", error);
    return fail("MY_TOURNAMENTS_READ_FAILED", 500);
  }
}
