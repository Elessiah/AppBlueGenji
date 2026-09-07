import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { liftEndurancePenalty } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";

/**
 * Retire une pénalité d'endurance : le rejeu rend les points et défait ce que
 * la sanction avait entraîné (`docs/features/ENDURANCE_PENALTIES.md`).
 *
 * C'est la seule façon de corriger une sanction saisie de travers — il n'y a
 * pas de pénalité négative. Même droit que pour l'infliger : `tournaments`.
 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string; penaltyId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id, penaltyId } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const penalty = Number(penaltyId);
  if (!Number.isInteger(penalty) || penalty <= 0) return fail("INVALID_PENALTY_ID", 400);

  try {
    await liftEndurancePenalty(tournamentId, penalty);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "NOT_BG_SURVIE" || message === "ENDURANCE_PLAYOFFS_STARTED") {
      return fail(message, 400);
    }
    if (message === "PENALTY_NOT_FOUND") return fail(message, 404);
    return fail(message || "PENALTY_LIFT_FAILED", 500);
  }
}
