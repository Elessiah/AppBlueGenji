import { getCurrentUser } from "@/lib/server/auth";
import { withConnection } from "@/lib/server/database";
import { fail, ok } from "@/lib/server/http";
import { writeDurationSettings } from "@/lib/server/planning/load";
import { planningFailure } from "@/lib/server/planning/routes";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { can } from "@/lib/shared/permissions";
import { validateDurationSettings } from "@/lib/shared/planning-durations";

/**
 * Règle les durées estimées du planning (permission `tournaments`) : minutes
 * par carte (OW, MR), marge par match, cartes par défaut, durée d'un tournoi
 * entier. Chaque valeur est un entier borné (`PLANNING_DURATION_BOUNDS`).
 */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const read = await readJsonObject(req, "INVALID_BODY", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const settings = validateDurationSettings(read.body);
  if (!settings) return fail("INVALID_DURATIONS", 400);

  try {
    await withConnection((connection) => writeDurationSettings(connection, settings));
    return ok({ durations: settings });
  } catch (error) {
    return planningFailure(error, "PLANNING_SETTINGS_FAILED");
  }
}
