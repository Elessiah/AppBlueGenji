import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { removeTournamentEntrant } from "@/lib/server/tournaments/registration-removal";
import { formatEntrantRemovedLog } from "@/lib/shared/bot-logs";
import { ENTRANT_REMOVAL_BLOCK_MESSAGES } from "@/lib/shared/entrant-removal";
import { can } from "@/lib/shared/permissions";

function readId(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Retire un engagé du plateau, tant que le tournoi n'a pas commencé.
 *
 * Réservé au staff `tournaments` — administrateur **ou** arbitre, comme
 * l'arbitrage des scores et le retour en arrière : c'est le même métier, tenir
 * un plateau. La suppression définitive d'un tournoi reste le seul geste du
 * domaine à exiger `isAdmin`, parce qu'elle seule est sans retour ; une
 * inscription retirée par erreur se repose, le tournoi étant encore ouvert.
 *
 * Un engagé, pas un lot : le refus d'un lot devrait nommer celui qui a bloqué
 * (`ghost-registrations`), et le geste inverse — cocher trente fantômes d'un
 * coup — n'a pas d'équivalent ici, où l'on retire une ligne qu'on vient de
 * regarder.
 */
export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string; teamId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id, teamId: rawTeamId } = await context.params;
  const tournamentId = readId(id);
  if (tournamentId === null) return fail("INVALID_TOURNAMENT_ID", 400);
  const teamId = readId(rawTeamId);
  if (teamId === null) return fail("INVALID_TEAM", 400);

  try {
    const removed = await removeTournamentEntrant(tournamentId, teamId);

    // Après le commit, au meilleur effort : le bot est optionnel, et la ligne
    // d'inscription est déjà effacée — il n'y a rien à annuler si le message ne
    // part pas. Le journal est en revanche le seul endroit où ce retrait laisse
    // une trace — l'auteur y est « le staff », et nommé dans pm2.
    publishStaffAction(
      formatEntrantRemovedLog({
        tournament: { id: removed.tournamentId, name: removed.tournamentName },
        entrant: { name: removed.entrantName, participantType: removed.participantType },
        registeredTeams: removed.registeredTeams,
        maxTeams: removed.maxTeams,
      }),
      { id: user.id, pseudo: user.pseudo },
    );

    return ok({ removed });
  } catch (error) {
    const message = (error as Error).message;

    if (message === "TOURNAMENT_NOT_FOUND" || message === "TEAM_NOT_IN_TOURNAMENT") {
      return fail(message, 404);
    }

    // 409 : la demande est bien formée, c'est l'état du tournoi qui la
    // contredit. La liste des codes vient du module pur, et non d'une énumération
    // recopiée : un refus ajouté demain est traduit sans qu'on y pense.
    //
    // `Object.hasOwn` et non `in`, qui remonte la chaîne de prototypes : un
    // message valant `constructor` ou `toString` passerait le test et ressortirait
    // en 409 sous son propre nom, sans que la panne réelle atteigne le journal.
    if (Object.hasOwn(ENTRANT_REMOVAL_BLOCK_MESSAGES, message)) return fail(message, 409);

    // Même précaution que la suppression et le retour en arrière : le texte
    // d'une erreur mysql2 est anglais et parle du moteur. Il reste au journal du
    // serveur, où il sert à quelque chose.
    console.error(
      `[tournaments] retrait de l'engagé ${teamId} du tournoi ${tournamentId} échoué :`,
      error,
    );
    return fail("ENTRANT_REMOVAL_FAILED", 500);
  }
}
