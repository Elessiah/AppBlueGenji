import { PLANNING_WRITE_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { planningFailure, readEntryKey } from "@/lib/server/planning/routes";
import { cleanWithdrawalReason, withdrawFromEntry } from "@/lib/server/planning/withdrawal";
import { readJsonObject, SMALL_JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { can } from "@/lib/shared/permissions";
import { isPlanningRole } from "@/lib/shared/planning";

/**
 * Le lecteur se désiste de **sa** attribution sur une entrée
 * (`CAST_PLANNING.md` § Désistement). Corps : `{ entryKey, role, reason? }`
 * (`reason` : motif facultatif, 300 caractères au plus, lu du seul staff des
 * tournois). Aucun identifiant de compte n'est lu : on ne désiste que soi.
 *
 * Pendant une incarnation (`ADMIN_ROLE_IMPERSONATION.md`), seule une place
 * que les rôles incarnés tiendraient se quitte (`withdrawableRoles`, jugé par
 * `withdrawFromEntry` : `403 PLAYER_VIEW_ACTIVE`) — la route du match
 * refuserait de même le retrait d'un arbitre.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "planning")) return fail("PLANNING_MEMBERS_ONLY", 403);
  const throttled = enforceRateLimit(PLANNING_WRITE_RULE, user.id);
  if (throttled) return throttled;

  const read = await readJsonObject(req, "INVALID_BODY", SMALL_JSON_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  const { entryKey: rawKey, role, reason: rawReason } = read.body;
  const entryKey = readEntryKey(rawKey);
  if (entryKey === null) return fail("INVALID_ENTRY", 400);
  if (!isPlanningRole(role)) return fail("INVALID_ROLE", 400);
  const reason = cleanWithdrawalReason(rawReason);
  if (reason === undefined) return fail("PLANNING_REASON_TOO_LONG", 400);

  try {
    const result = await withdrawFromEntry(user, { entryKey, role, reason });
    return ok(result);
  } catch (error) {
    return planningFailure(error, "PLANNING_WITHDRAWAL_FAILED");
  }
}
