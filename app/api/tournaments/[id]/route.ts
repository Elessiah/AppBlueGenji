import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, TOURNAMENT_READ_RULE } from "@/lib/server/api-guard";
import { serviceErrorCode } from "@/lib/server/failure-reason";
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
  // Une panne SQL (pool épuisé, délai de verrou, interblocage) rend un code
  // `fail()` — 409 « réessaie » pour une contention, 500 sinon — et non le 500
  // nu de Next, sans corps lisible par l'interface.
  let detail: Awaited<ReturnType<typeof getTournamentDetail>>;
  try {
    detail = await getTournamentDetail(tournamentId, user.id, {
      canManage: can(user, "tournaments"),
      canPreview: canAny(user, ["tournaments", "casting"]),
      canManageLive: can(user, "live"),
      // Suppression définitive : administrateur strict. `can(user, "tournaments")`
      // ne convient pas — un arbitre gère le tournoi, il ne l'efface pas.
      canDelete: user.isAdmin === true,
      // Annuler un abandon : administrateur strict (FORFEIT_CANCELLATION.md).
      canCancelForfeit: user.isAdmin === true,
    });
  } catch (error) {
    return fail(serviceErrorCode(error, "INTERNAL_ERROR"), 500);
  }
  if (!detail) return fail("TOURNAMENT_NOT_FOUND", 404);

  return ok(detail);
}
