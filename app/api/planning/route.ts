import { PLANNING_READ_BURST_RULE, PLANNING_READ_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { planningFailure } from "@/lib/server/planning/routes";
import { loadPlanningView } from "@/lib/server/planning/view";
import { can } from "@/lib/shared/permissions";

/**
 * Le planning des casts et arbitres (`docs/features/CAST_PLANNING.md`) :
 * permission `planning` (arbitres, casters, prods, administrateurs) ; en vue
 * joueur, aucun droit — 403.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "planning")) return fail("FORBIDDEN", 403);
  // La rafale d'abord : une lecture qu'elle refuse ne compte pas dans la fenêtre de cinq minutes.
  const throttled = enforceRateLimit(PLANNING_READ_BURST_RULE, user.id) ?? enforceRateLimit(PLANNING_READ_RULE, user.id);
  if (throttled) return throttled;
  try {
    return ok({ planning: await loadPlanningView(user) });
  } catch (error) {
    return planningFailure(error, "PLANNING_LOAD_FAILED");
  }
}
