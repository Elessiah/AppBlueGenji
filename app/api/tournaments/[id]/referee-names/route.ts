import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, TOURNAMENT_READ_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { loadRefereeNames } from "@/lib/server/tournaments/referee-names";
import { can } from "@/lib/shared/permissions";

/**
 * Pseudos des arbitres désignés d'un tournoi (décision 52,
 * `docs/features/MATCH_REFEREE.md`) : la relecture **légère** du morceau du
 * contexte du lecteur qui suit une désignation changée (`refereeKey` de
 * l'instantané sans pseudo connu). Mêmes conditions que la lecture REST du
 * détail : une session (la page sans compte lit « Arbitre désigné ») et un
 * tournoi visible. Les pseudos sont les mêmes pour tous les membres : lus une
 * fois par version d'instantané.
 */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(TOURNAMENT_READ_RULE, user.id);
  if (throttled) return throttled;

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const snapshot = await getVisibleTournamentSnapshot(tournamentId, { canManage: can(user, "tournaments") });
  if (!snapshot) return fail("TOURNAMENT_NOT_FOUND", 404);

  return ok({ refereeNames: await loadRefereeNames(snapshot) });
}
