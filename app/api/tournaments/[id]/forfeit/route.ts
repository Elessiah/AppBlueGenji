import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { canActOnTournament } from "@/lib/server/tournaments/write-visibility";
import { forfeitTournamentTeam, getUserEntrant } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
import { readJsonBody } from "@/lib/server/request-body";

/**
 * Déclare le forfait d'un engagé dans un tournoi « Survie » ou « Ronde suisse »
 * — les formats où l'on reste en lice sans être éliminé par une défaite.
 * - Un joueur déclare le forfait de son engagé : son équipe active, ou lui-même
 *   si le tournoi est individuel. **Il lui faut la charge de l'équipe**
 *   (`OWNER` ou `MANAGER`), comme pour l'inscrire : retirer une équipe d'un
 *   tournoi la condamne — capital à zéro en BG Survie, éliminée ailleurs — et
 *   c'est irréversible. Un joueur du roster ne pouvait pas engager son équipe,
 *   mais pouvait la désengager : le geste le plus lourd des deux était le moins
 *   gardé. En individuel la question ne se pose pas, l'engagé est le joueur.
 * - Un arbitre/admin peut forcer le forfait de n'importe quel engagé (`teamId`).
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  // Tournoi non publié : même 404 qu'un identifiant inexistant, avant tout
  // autre refus (`write-visibility.ts`).
  if (!(await canActOnTournament(tournamentId, user))) return fail("TOURNAMENT_NOT_FOUND", 404);

  const body = (await readJsonBody(req).catch(() => ({}))) as { teamId?: number };
  const isReferee = can(user, "tournaments");

  // `actingUserId` à `null` = arbitrage : le service ne revérifie alors aucun engagé.
  const acting =
    isReferee && body.teamId
      ? { teamId: Number(body.teamId), actingUserId: null }
      : await resolveOwnForfeit(tournamentId, user.id, body.teamId);
  if (acting instanceof Response) return acting;
  const { teamId, actingUserId } = acting;

  if (!Number.isInteger(teamId) || teamId <= 0) return fail("INVALID_TEAM", 400);

  try {
    await forfeitTournamentTeam(tournamentId, teamId, actingUserId);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "FORFEIT_FAILED", FORFEIT_ERROR_STATUS.get(message) ?? 500);
  }
}

/**
 * Engagé qu'un non-arbitre fait abandonner : le sien, et seulement s'il a
 * qualité pour agir en son nom. Rend la réponse de refus sinon.
 */
async function resolveOwnForfeit(
  tournamentId: number,
  userId: number,
  requestedTeamId: number | undefined,
): Promise<{ teamId: number; actingUserId: number } | Response> {
  let entrant: Awaited<ReturnType<typeof getUserEntrant>>;
  try {
    entrant = await getUserEntrant(tournamentId, userId);
  } catch (error) {
    // Tournoi inconnu : ne pas le maquiller en problème d'équipe.
    if ((error as Error).message === "TOURNAMENT_NOT_FOUND") {
      return fail("TOURNAMENT_NOT_FOUND", 404);
    }
    throw error;
  }
  if (entrant.teamId === null) return fail("NO_ACTIVE_TEAM", 400);
  // Même refus et même code que l'inscription : c'est la même qualité qu'on
  // exige, pour la même raison — l'acte engage l'équipe entière.
  //
  // Ce contrôle-ci sert à répondre vite et juste ; le service le rejoue dans
  // sa transaction, seul endroit où le droit fasse foi.
  if (!entrant.canActForEntrant) return fail("NOT_TEAM_MANAGER", 403);
  // Un non-arbitre ne peut forfaiter que son propre engagé.
  if (requestedTeamId && Number(requestedTeamId) !== entrant.teamId) {
    return fail("FORBIDDEN", 403);
  }
  return { teamId: entrant.teamId, actingUserId: userId };
}

const FORFEIT_ERROR_STATUS: ReadonlyMap<string, number> = new Map([
  ["NOT_SURVIVAL", 400],
  ["NOT_SWISS", 400],
  ["NOT_BG_SURVIE", 400],
  ["ENDURANCE_PLAYOFFS_STARTED", 400],
  ["FORMAT_WITHOUT_FORFEIT", 400],
  ["TOURNAMENT_NOT_RUNNING", 400],
  ["TEAM_ALREADY_OUT", 400],
  ["TEAM_NOT_IN_TOURNAMENT", 404],
  // Le droit a changé entre la lecture ci-dessus et l'écriture : le service
  // tranche, la route se contente de traduire.
  ["NOT_TEAM_MANAGER", 403],
  ["FORBIDDEN", 403],
  ["TOURNAMENT_NOT_FOUND", 404],
]);
