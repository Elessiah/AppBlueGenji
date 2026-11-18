import { PLANNING_WRITE_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setManualAssignment } from "@/lib/server/planning/actions";
import { planningFailure, readEntryKey } from "@/lib/server/planning/routes";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { isPositiveId } from "@/lib/server/tournaments/match-launch-routes";
import { can } from "@/lib/shared/permissions";
import { isPlanningRole } from "@/lib/shared/planning";

/**
 * Désignation à la main d'un membre du planning (permission `tournaments`,
 * celle qui désigne l'arbitre d'un match). Corps :
 * `{ entryKey, role, userId, assigned: boolean }`. Jamais remplacée par un calcul.
 */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);
  const throttled = enforceRateLimit(PLANNING_WRITE_RULE, user.id);
  if (throttled) return throttled;

  const read = await readJsonObject(req, "INVALID_BODY", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const { entryKey: rawKey, role, userId, assigned } = read.body;
  const entryKey = readEntryKey(rawKey);
  if (entryKey === null) return fail("INVALID_ENTRY", 400);
  if (!isPlanningRole(role)) return fail("INVALID_ROLE", 400);
  if (!isPositiveId(userId)) return fail("INVALID_USER_ID", 400);
  if (typeof assigned !== "boolean") return fail("INVALID_ASSIGNED", 400);

  try {
    await setManualAssignment(user, { entryKey, role, userId, assigned });
    return ok({ saved: true });
  } catch (error) {
    return planningFailure(error, "PLANNING_ASSIGNMENT_FAILED");
  }
}
