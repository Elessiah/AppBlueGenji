import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { cancelTournamentForfeit } from "@/lib/server/tournaments/forfeit-cancellation";
import { formatForfeitCancelledLog } from "@/lib/shared/bot-logs";

function readId(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Annule l'abandon d'un engagé : il revient en lice, le match perdu par
 * forfait reste perdu (`docs/features/FORFEIT_CANCELLATION.md`).
 *
 * **Administrateur strict** (`user.isAdmin`), et non la permission
 * `tournaments` : décision du propriétaire du site. Un abandon se déclare par
 * l'équipe elle-même ou par l'arbitrage ; le revenir en arrière remet dans la
 * course une équipe que d'autres croyaient sortie, et seul un administrateur
 * tranche ce cas.
 */
export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string; teamId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (user.isAdmin !== true) return fail("FORBIDDEN", 403);

  const { id, teamId: rawTeamId } = await context.params;
  const tournamentId = readId(id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);
  const teamId = readId(rawTeamId);
  if (teamId === null) return fail("INVALID_TEAM", 400);

  try {
    const cancelled = await cancelTournamentForfeit(tournamentId, teamId);

    // Après le commit, au meilleur effort : le bot est optionnel, l'équipe est
    // déjà remise en lice. Auteur anonyme sur Discord, nommé dans pm2.
    publishStaffAction(
      formatForfeitCancelledLog({
        tournament: { id: cancelled.tournamentId, name: cancelled.tournamentName },
        entrant: { name: cancelled.entrantName, participantType: cancelled.participantType },
      }),
      { id: user.id, pseudo: user.pseudo },
    );

    return ok({ cancelled });
  } catch (error) {
    const message = (error as Error).message;
    const status = CANCEL_ERROR_STATUS.get(message);
    if (status !== undefined) return fail(message, status);

    // Le texte d'une erreur mysql2 est anglais et parle du moteur : il reste au
    // journal du serveur.
    console.error(
      `[tournaments] annulation de l'abandon de ${teamId} au tournoi ${tournamentId} échouée :`,
      error,
    );
    return fail("FORFEIT_CANCEL_FAILED", 500);
  }
}

const CANCEL_ERROR_STATUS: ReadonlyMap<string, number> = new Map([
  ["TOURNAMENT_NOT_FOUND", 404],
  ["TEAM_NOT_IN_TOURNAMENT", 404],
  // 409 : la demande est bien formée, c'est l'état du tournoi qui la contredit.
  ["TOURNAMENT_NOT_RUNNING", 409],
  ["FORMAT_WITHOUT_FORFEIT", 409],
  ["ENDURANCE_PLAYOFFS_STARTED", 409],
  ["TEAM_NOT_FORFEITED", 409],
]);
