import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { launchTournamentNow } from "@/lib/server/tournaments/launch";
import { can } from "@/lib/shared/permissions";

/**
 * Abrège les étapes d'avant-course du tournoi et le lance immédiatement.
 *
 * Réservé au staff `tournaments` (administrateur ou arbitre), et non aux seuls
 * administrateurs : lancer un tournoi est un acte d'organisation, celui-là même
 * que la clôture des inscriptions et l'arbitrage des scores supposent déjà. La
 * suppression définitive reste le seul geste du domaine à exiger `isAdmin`,
 * parce qu'elle, rien ne la rejoue.
 *
 * `POST` sans corps : l'action n'a pas de paramètre — les dates sont déduites de
 * l'instant du lancement (`lib/shared/tournament-launch.ts`). Laisser le client
 * proposer une date rouvrirait par la fenêtre ce que l'édition refuse par la
 * porte : un tournoi antidaté d'une semaine.
 */
export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  try {
    const launched = await launchTournamentNow(tournamentId);
    return ok({ launched });
  } catch (error) {
    const message = (error as Error).message;

    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);

    // Il n'y a plus rien à abréger : le tournoi a déjà démarré, ou s'est
    // terminé. 409 — l'état du tournoi contredit la demande, la demande
    // elle-même est bien formée.
    if (message === "TOURNAMENT_ALREADY_STARTED" || message === "TOURNAMENT_ALREADY_FINISHED") {
      return fail(message, 409);
    }

    if (message === "INVALID_DATES" || message === "INVALID_DATE_ORDER") {
      return fail(message, 400);
    }

    // Même précaution que la suppression : le texte d'une erreur mysql2 est
    // anglais et parle du moteur. Il reste au journal du serveur.
    console.error(`[tournaments] lancement anticipé du tournoi ${tournamentId} échoué :`, error);
    return fail("TOURNAMENT_LAUNCH_FAILED", 500);
  }
}
