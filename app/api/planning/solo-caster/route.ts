import { PLANNING_WRITE_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setSoloCaster } from "@/lib/server/planning/actions";
import { planningFailure } from "@/lib/server/planning/routes";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { isPositiveId } from "@/lib/server/tournaments/match-launch-routes";
import { can, canComputePlanning } from "@/lib/shared/permissions";

/**
 * Réglage « caster autonome » (il diffuse seul, sans prod). Corps :
 * `{ solo: boolean, userId?: number }`. Sans `userId` (ou le sien) : un
 * caster règle le sien (permission `planning`) ; pour un autre compte,
 * il faut être administrateur (`canComputePlanning`, panneau de calcul).
 */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "planning")) return fail("PLANNING_MEMBERS_ONLY", 403);
  const throttled = enforceRateLimit(PLANNING_WRITE_RULE, user.id);
  if (throttled) return throttled;

  const read = await readJsonObject(req, "INVALID_BODY", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const { solo, userId } = read.body;
  if (typeof solo !== "boolean") return fail("INVALID_SOLO", 400);
  if (userId !== undefined && !isPositiveId(userId)) return fail("INVALID_USER_ID", 400);
  const target = userId ?? user.id;
  if (target !== user.id && !canComputePlanning(user)) return fail("PLANNING_ADMIN_ONLY", 403);

  try {
    await setSoloCaster(target, solo);
    return ok({ saved: true });
  } catch (error) {
    return planningFailure(error, "PLANNING_SOLO_FAILED");
  }
}
