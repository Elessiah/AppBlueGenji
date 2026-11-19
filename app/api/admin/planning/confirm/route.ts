import { PLANNING_BATCH_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { confirmAssignments } from "@/lib/server/planning/auto-assign";
import { readConfirmScope } from "@/lib/server/planning/request";
import { planningFailure } from "@/lib/server/planning/routes";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { canComputePlanning } from "@/lib/shared/permissions";

/**
 * Confirme des propositions provisoires (administrateur seul, `canComputePlanning`) : celles
 * des entrées nommées (`entryKeys`) et/ou de toutes les entrées qui
 * commencent avant `until` (ISO). Les autres restent provisoires ; les lots
 * suivants se calculent autour des confirmées. Rend `ConfirmReport`.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!canComputePlanning(user)) return fail("PLANNING_ADMIN_ONLY", 403);
  const read = await readJsonObject(req, "INVALID_BODY", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const scope = readConfirmScope(read.body);
  if (!scope) return fail("INVALID_CONFIRM_SCOPE", 400);
  // Décompté après la validation : une requête mal formée n'use pas le quota des gestes qui tiennent le verrou.
  const throttled = enforceRateLimit(PLANNING_BATCH_RULE, user.id);
  if (throttled) return throttled;

  try {
    return ok({ report: await confirmAssignments(user.id, scope) });
  } catch (error) {
    return planningFailure(error, "PLANNING_CONFIRM_FAILED");
  }
}
