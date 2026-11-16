import { AUDIENCE_REQUEST_RULE, enforceRateLimit, requestClientIp } from "@/lib/server/api-guard";
import { maintainAudience, recordAudienceViews } from "@/lib/server/audience-service";
import { failureReason } from "@/lib/server/failure-reason";
import { ok } from "@/lib/server/http";
import { SMALL_JSON_BODY_MAX_BYTES, readJsonBody } from "@/lib/server/request-body";
import { isBotUserAgent, parseAudienceBatch } from "@/lib/shared/audience";
import { audienceOptOutFromHeaders } from "@/lib/shared/site-visits";

export const dynamic = "force-dynamic";

/**
 * Reçoit la file de pages vues d'un navigateur (`<AudienceBeacon />`,
 * `docs/features/AUDIENCE_MEASUREMENT.md`, registre T19).
 *
 * Public par nécessité, silencieux par principe : toute issue répond `200`
 * (seul le plafond par IP répond `429`)
 * avec le nombre de pages retenues, pour ne jamais faire paraître d'erreur
 * dans la console d'un visiteur. Ni session lue, ni cookie posé.
 */
export async function POST(req: Request) {
  // Repli et purge entraînés par le trafic, que l'envoi soit retenu ou non.
  maintainAudience();

  // Opposition (GPC, DNT, bouton de `/rgpd#audience`) relue avant tout calcul :
  // ni empreinte, ni décompte du plafond (qui garderait l'IP en mémoire).
  if (audienceOptOutFromHeaders(req.headers)) return ok({ recorded: 0 });

  const userAgent = req.headers.get("user-agent");
  if (isBotUserAgent(userAgent)) return ok({ recorded: 0 });

  const ip = requestClientIp(req);
  const throttled = enforceRateLimit(AUDIENCE_REQUEST_RULE, ip);
  if (throttled) return throttled;

  let body: unknown = null;
  try {
    body = await readJsonBody(req, SMALL_JSON_BODY_MAX_BYTES);
  } catch {
    return ok({ recorded: 0 });
  }

  const views = parseAudienceBatch(body);
  if (views.length === 0) return ok({ recorded: 0 });
  try {
    return ok({ recorded: await recordAudienceViews({ ip, userAgent, views }) });
  } catch (error) {
    // Sel du jour illisible (base injoignable) : l'envoi est perdu, sans bruit chez le visiteur.
    console.error("[audience] Pages vues écartées : sel du jour illisible.", failureReason(error));
    return ok({ recorded: 0 });
  }
}
