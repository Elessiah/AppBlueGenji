/**
 * Alertes d'annonces GETI du compte connecté — `docs/features/GETI_INFO.md`
 * § Alertes.
 *
 * `GET` rend ses alertes ; `POST` en crée une pour la catégorie et la
 * recherche données (`{ category, search, name? }`), dans la limite de
 * `GETI_ALERT_MAX_PER_USER`. Une réponse d'erreur ne porte qu'un code.
 */
import { enforceRateLimit } from "@/lib/server/api-guard";
import { getCurrentUser } from "@/lib/server/auth";
import { failureReason } from "@/lib/server/failure-reason";
import { GETI_ALERT_BODY_MAX_BYTES, GETI_ALERT_WRITE_RULE, getiAlertRefusalStatus } from "@/lib/server/geti/alert-route";
import { createGetiAlert, listGetiAlerts } from "@/lib/server/geti/alerts";
import { fail, ok } from "@/lib/server/http";
import { readJsonObject } from "@/lib/server/request-body";
import { GETI_ALERT_ERRORS, GETI_ALERT_MAX_PER_USER } from "@/lib/shared/geti/alerts";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail(GETI_ALERT_ERRORS.unauthorized, 401);
  try {
    return ok({ alerts: await listGetiAlerts(user.id), max: GETI_ALERT_MAX_PER_USER });
  } catch (error) {
    console.error("[geti] lecture des alertes impossible", failureReason(error));
    return fail(GETI_ALERT_ERRORS.unavailable, 503);
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail(GETI_ALERT_ERRORS.unauthorized, 401);
  const limited = enforceRateLimit(GETI_ALERT_WRITE_RULE, `user:${user.id}`);
  if (limited) return limited;

  const read = await readJsonObject(req, GETI_ALERT_ERRORS.invalid, GETI_ALERT_BODY_MAX_BYTES);
  if ("refusal" in read) return fail(read.refusal, 400);
  try {
    const result = await createGetiAlert(user.id, read.body);
    if (typeof result === "string") return fail(result, getiAlertRefusalStatus(result));
    return ok({ alert: result }, 201);
  } catch (error) {
    console.error("[geti] création d'une alerte impossible", failureReason(error));
    return fail(GETI_ALERT_ERRORS.unavailable, 503);
  }
}
