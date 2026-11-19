import { PLANNING_BATCH_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { runAutoAssign } from "@/lib/server/planning/auto-assign";
import { readWindow } from "@/lib/server/planning/request";
import { planningFailure } from "@/lib/server/planning/routes";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { canComputePlanning } from "@/lib/shared/permissions";

/**
 * Lance un lot du calcul automatique (administrateur seul, `canComputePlanning`) sur une
 * fenêtre `{ from, to }` (ISO, 31 jours au plus) : les propositions
 * provisoires de la fenêtre sont recalculées ensemble, sans toucher aux choix
 * du staff ni aux confirmées. Rend son bilan (`AutoAssignReport`).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!canComputePlanning(user)) return fail("PLANNING_ADMIN_ONLY", 403);
  const read = await readJsonObject(req, "INVALID_BODY", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const window = readWindow(read.body);
  if (!window) return fail("INVALID_WINDOW", 400);
  // Décompté après la validation : une requête mal formée n'use pas le quota des gestes qui tiennent le verrou.
  const throttled = enforceRateLimit(PLANNING_BATCH_RULE, user.id);
  if (throttled) return throttled;

  try {
    return ok({ report: await runAutoAssign(user.id, window) });
  } catch (error) {
    return planningFailure(error, "PLANNING_AUTO_ASSIGN_FAILED");
  }
}
