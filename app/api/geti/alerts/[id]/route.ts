/**
 * Une alerte d'annonces GETI du compte connecté — `docs/features/GETI_INFO.md`
 * § Alertes.
 *
 * `PATCH` la renomme, la met en pause ou la relance (`{ name?, paused? }`) ;
 * `DELETE` la supprime. Une alerte d'un autre compte est introuvable (404),
 * jamais « interdite » : son existence ne se devine pas.
 */
import { enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { failureReason } from "@/lib/server/failure-reason";
import {
  GETI_ALERT_BODY_MAX_BYTES,
  GETI_ALERT_WRITE_RULE,
  getiAlertRefusalStatus,
  parseGetiAlertId,
} from "@/lib/server/geti/alert-route";
import { deleteGetiAlert, updateGetiAlert } from "@/lib/server/geti/alerts";
import { fail, ok } from "@/lib/server/http";
import { readJsonObject } from "@/lib/server/request-body";
import { GETI_ALERT_ERRORS } from "@/lib/shared/geti/alerts";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return fail(GETI_ALERT_ERRORS.unauthorized, 401);
  const limited = enforceRateLimit(GETI_ALERT_WRITE_RULE, `user:${user.id}`);
  if (limited) return limited;
  const alertId = parseGetiAlertId((await context.params).id);
  if (alertId === null) return fail(GETI_ALERT_ERRORS.notFound, 404);

  const read = await readJsonObject(req, GETI_ALERT_ERRORS.invalid, GETI_ALERT_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  try {
    const result = await updateGetiAlert(user.id, alertId, read.body);
    if (typeof result === "string") return fail(result, getiAlertRefusalStatus(result));
    return ok({ alert: result });
  } catch (error) {
    console.error("[geti] changement d'une alerte impossible", failureReason(error));
    return fail(GETI_ALERT_ERRORS.unavailable, 503);
  }
}

export async function DELETE(_: Request, context: Context) {
  const user = await getCurrentUser();
  if (!user) return fail(GETI_ALERT_ERRORS.unauthorized, 401);
  const limited = enforceRateLimit(GETI_ALERT_WRITE_RULE, `user:${user.id}`);
  if (limited) return limited;
  const alertId = parseGetiAlertId((await context.params).id);
  if (alertId === null) return fail(GETI_ALERT_ERRORS.notFound, 404);
  try {
    if (!(await deleteGetiAlert(user.id, alertId))) return fail(GETI_ALERT_ERRORS.notFound, 404);
    return ok({ deleted: true });
  } catch (error) {
    console.error("[geti] suppression d'une alerte impossible", failureReason(error));
    return fail(GETI_ALERT_ERRORS.unavailable, 503);
  }
}
