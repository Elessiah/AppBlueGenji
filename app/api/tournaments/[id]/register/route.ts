import { getCurrentUser } from "@/lib/server/auth";
import { sendBotLog } from "@/lib/server/bot-integration";
import { unexpectedFailureCode } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { canActOnTournament } from "@/lib/server/tournaments/write-visibility";
import { withdrawOwnRegistration } from "@/lib/server/tournaments/registration-removal";
import { registerCurrentUserTeam } from "@/lib/server/tournaments-service";
import { CONCURRENT_UPDATE_RETRY } from "@/lib/shared/api-error-code";
import { formatEntrantWithdrawnLog } from "@/lib/shared/bot-logs";
import { ENTRANT_REMOVAL_BLOCK_MESSAGES } from "@/lib/shared/entrant-removal";
import { isRegistrationFilterError } from "@/lib/shared/registration-filters";
import { TERMS_ACCEPTANCE_REQUIRED } from "@/lib/shared/terms-of-use";

/**
 * Désinscription par le joueur lui-même, tant que le tournoi n'a pas commencé
 * (`docs/features/SELF_WITHDRAWAL.md`) : son équipe active s'il en a la charge
 * (`OWNER`/`MANAGER`), son entrée solo en tournoi individuel.
 */
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  // Tournoi non publié : même 404 qu'un identifiant inexistant (`write-visibility.ts`).
  if (!(await canActOnTournament(tournamentId, user))) return fail("TOURNAMENT_NOT_FOUND", 404);

  try {
    const removed = await withdrawOwnRegistration(tournamentId, user.id);

    // Après le commit, au meilleur effort : la ligne d'inscription est déjà
    // effacée, et le canal est le seul endroit où la trace subsiste. Aucun
    // pseudo n'y part (« un joueur » en individuel).
    sendBotLog(
      formatEntrantWithdrawnLog({
        tournament: { id: removed.tournamentId, name: removed.tournamentName },
        entrant: { name: removed.entrantName, participantType: removed.participantType },
        registeredTeams: removed.registeredTeams,
        maxTeams: removed.maxTeams,
      }),
      { category: "registrations", tournamentId: removed.tournamentId },
    );

    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "NOT_TEAM_MANAGER") return fail(message, 403);
    if (message === "NO_ACTIVE_TEAM") return fail(message, 400);
    // L'équipe active a changé pendant l'attente du verrou : réessayer tranche.
    if (message === CONCURRENT_UPDATE_RETRY) return fail(message, 409);
    if (message === "TOURNAMENT_NOT_FOUND" || message === "TEAM_NOT_IN_TOURNAMENT") {
      return fail(message, 404);
    }
    // `Object.hasOwn` et non `in` : voir la route de retrait par le staff.
    if (Object.hasOwn(ENTRANT_REMOVAL_BLOCK_MESSAGES, message)) return fail(message, 409);
    return fail(
      unexpectedFailureCode(error, "WITHDRAWAL_FAILED", `[tournaments] désinscription du tournoi ${tournamentId} échouée`),
      500,
    );
  }
}

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
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

  try {
    await registerCurrentUserTeam(tournamentId, user.id);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    // Le refus de qualité est un refus de **droits**, pas de forme : le joueur
    // a bien une équipe, il n'a simplement pas la charge de l'engager
    // (`OWNER`/`MANAGER`, voir `lib/shared/team-roles.ts`).
    if (message === "NOT_TEAM_MANAGER") return fail(message, 403);
    // Gérant qui n'a pas accepté les conditions d'utilisation : la saisie est
    // bonne, l'état du compte ne convient pas — et il se corrige d'un clic.
    if (message === TERMS_ACCEPTANCE_REQUIRED) return fail(message, 409);

    // Conditions d'inscription non remplies (`lib/shared/registration-filters.ts`).
    // **409 et non 400** : la saisie est bonne, c'est l'état de l'équipe qui ne
    // convient pas — et il se corrige (recruter, certifier un tag, rattacher un
    // compte Blizzard), ce qu'un « requête invalide » ne laisserait pas entendre.
    //
    // Le test vient du module pur : la liste était recopiée ici, et un refus
    // ajouté là-bas sans l'être ici serait ressorti en 500.
    if (isRegistrationFilterError(message)) return fail(message, 409);

    if (
      message === "NO_ACTIVE_TEAM"
      || message === "REGISTRATION_CLOSED"
      || message === "TOURNAMENT_FULL"
      || message === "ALREADY_REGISTERED"
      || message === "SOLO_ENTRY_NAME_UNAVAILABLE"
    ) {
      return fail(message, 400);
    }

    if (message === "TOURNAMENT_NOT_FOUND" || message === "USER_NOT_FOUND") return fail(message, 404);
    return fail(message || "REGISTRATION_FAILED", 500);
  }
}
