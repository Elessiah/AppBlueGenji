import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { setAvailability } from "@/lib/server/planning/actions";
import { planningFailure, readEntryKey } from "@/lib/server/planning/routes";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { can } from "@/lib/shared/permissions";
import { isAvailabilityStatus, isPlanningRole } from "@/lib/shared/planning";

/**
 * Disponibilité du lecteur pour une entrée, dans un rôle qu'il tient. Corps :
 * `{ entryKey, role, status, preferred }` (`status` : `AVAILABLE`,
 * `UNAVAILABLE` ou `PENDING` ; `preferred` : booléen, « je veux ce match »).
 */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "planning")) return fail("FORBIDDEN", 403);

  const read = await readJsonObject(req, "INVALID_BODY", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const { entryKey: rawKey, role, status, preferred } = read.body;
  const entryKey = readEntryKey(rawKey);
  if (entryKey === null) return fail("INVALID_ENTRY", 400);
  if (!isPlanningRole(role)) return fail("INVALID_ROLE", 400);
  if (!isAvailabilityStatus(status)) return fail("INVALID_STATUS", 400);
  if (typeof preferred !== "boolean") return fail("INVALID_PREFERENCE", 400);

  try {
    await setAvailability(user, { entryKey, role, status, preferred });
    return ok({ saved: true });
  } catch (error) {
    return planningFailure(error, "PLANNING_AVAILABILITY_FAILED");
  }
}
