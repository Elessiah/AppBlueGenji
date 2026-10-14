import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { SMALL_JSON_BODY_MAX_BYTES, readJsonBody } from "@/lib/server/request-body";
import { INVALID_MATCH_DM_PREFERENCE, recordMatchDmPreference } from "@/lib/server/users/match-dm-preference";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";

/**
 * Messages privés Discord de match, depuis « Mon profil » :
 * `{ "enabled": boolean }` (`lib/server/users/match-dm-preference.ts`). Les
 * notifications push gardent leurs propres réglages. Écriture de `/api/` : la
 * provenance est vérifiée par le middleware, comme pour toute autre.
 */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  let enabled: unknown;
  try {
    enabled = ((await readJsonBody(req, SMALL_JSON_BODY_MAX_BYTES)) as { enabled?: unknown }).enabled;
  } catch {
    return fail("INVALID_BODY", 400);
  }
  if (typeof enabled !== "boolean") return fail(INVALID_MATCH_DM_PREFERENCE, 400);

  try {
    if (!(await recordMatchDmPreference(user.id, enabled))) return fail(ACCOUNT_DELETED_ERROR, 409);
    return ok({ enabled });
  } catch (error) {
    console.error("[profile] PUT match-dms failed:", error);
    return fail("PROFILE_UPDATE_FAILED", 400);
  }
}
