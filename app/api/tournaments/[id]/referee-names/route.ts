import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, TOURNAMENT_READ_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import { loadLiveRefereeNames, markViewerReferee, viewerDesignated } from "@/lib/server/tournaments/referee-names";
import { loadViewerRefereeEligible } from "@/lib/server/tournaments/match-launch";
import { can } from "@/lib/shared/permissions";

/**
 * Pseudos des arbitres désignés d'un tournoi (décision 52,
 * `docs/features/MATCH_REFEREE.md`) : la relecture **légère** du morceau du
 * contexte du lecteur qui suit une désignation changée (`refereeKey` de
 * l'instantané sans pseudo connu). Mêmes conditions que la lecture REST du
 * détail : une session (la page sans compte lit « Arbitre désigné ») et un
 * tournoi visible — lu sur sa carte seule (`getVisibleTournamentCard`), les
 * pseudos par une requête dédiée (`loadLiveRefereeNames`) : l'instantané entier
 * n'est jamais reconstruit pour une étiquette. Les pseudos sont les mêmes pour
 * tous les membres : lus une fois jusqu'à la prochaine écriture du tournoi.
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

  const manages = can(user, "tournaments");
  const card = await getVisibleTournamentCard(tournamentId, { canManage: manages });
  if (!card) return fail("TOURNAMENT_NOT_FOUND", 404);

  const read = await loadLiveRefereeNames(card);
  // Marque par lecteur (`mine`) : l'arbitre désigné y reconnaît ses matchs, s'il
  // remplit encore la condition d'arbitrage — son identité n'est lue que s'il
  // arbitre un des matchs montrés.
  const eligible = viewerDesignated(read, user.id) && (await loadViewerRefereeEligible(user.id, manages, card.game));
  return ok({ refereeNames: markViewerReferee(read, user.id, eligible) });
}
