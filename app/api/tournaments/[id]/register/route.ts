import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { registerCurrentUserTeam } from "@/lib/server/tournaments-service";
import { isRegistrationFilterError } from "@/lib/shared/registration-filters";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  try {
    await registerCurrentUserTeam(tournamentId, user.id);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    // Le refus de qualité est un refus de **droits**, pas de forme : le joueur
    // a bien une équipe, il n'a simplement pas la charge de l'engager
    // (`OWNER`/`MANAGER`, voir `lib/shared/team-roles.ts`).
    if (message === "NOT_TEAM_MANAGER") return fail(message, 403);

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
