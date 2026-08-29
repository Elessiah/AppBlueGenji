import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, TOURNAMENT_READ_RULE } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { getTournamentDetail } from "@/lib/server/tournaments-service";
import { can, canAny } from "@/lib/shared/permissions";

/**
 * Détail d'un tournoi. Chemin de **secours** : en marche normale la page reçoit
 * la donnée par le flux SSE (`./stream`), qui la calcule une fois pour tous les
 * spectateurs. Cette route sert au premier rendu quand le flux est coupé, et au
 * retour immédiat après une action de l'utilisateur.
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

  // L'aperçu du plateau va plus loin que la gestion : le cast y a droit sans
  // pouvoir rien modifier (`docs/features/TOURNAMENT_PREVIEW.md`). La diffusion
  // est, elle, un droit d'écriture à part (`docs/features/LIVE_STREAMS.md`).
  const detail = await getTournamentDetail(
    tournamentId,
    user.id,
    can(user, "tournaments"),
    canAny(user, ["tournaments", "casting"]),
    can(user, "live"),
  );
  if (!detail) return fail("TOURNAMENT_NOT_FOUND", 404);

  return ok(detail);
}
