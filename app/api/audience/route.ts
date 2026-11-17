import { admitAudienceViews, requestClientIp, throttleAudienceRequest } from "@/lib/server/api-guard";
import { maintainAudience, recordAudienceViews } from "@/lib/server/audience-service";
import { failureReason } from "@/lib/server/failure-reason";
import { ok } from "@/lib/server/http";
import { SMALL_JSON_BODY_MAX_BYTES, readJsonBody } from "@/lib/server/request-body";
import { siteBaseUrl } from "@/lib/server/site-url";
import { isAudienceScriptRequest, isBotUserAgent, parseAudienceBatch } from "@/lib/shared/audience";
import { audienceOptOutFromHeaders } from "@/lib/shared/site-visits";

export const dynamic = "force-dynamic";

/**
 * Reçoit la file de pages vues d'un navigateur (`<AudienceBeacon />`,
 * `docs/features/AUDIENCE_MEASUREMENT.md`, registre T19).
 *
 * Public par nécessité, silencieux par principe : toute issue répond `200`
 * (seul le plafond par réseau répond `429`)
 * avec le nombre de pages retenues, pour ne jamais faire paraître d'erreur
 * dans la console d'un visiteur. Ni session lue, ni cookie posé.
 *
 * Contre les signalements fabriqués (qui gonfleraient les chiffres montrés aux
 * partenaires) : un envoi qui se déclare d'une autre origine est écarté
 * (`isAudienceScriptRequest`), et chaque réseau (puis son `/48` en IPv6, puis
 * le site entier) est plafonné en envois, en navigateurs distincts et en
 * pages vues (`throttleAudienceRequest`, `admitAudienceViews`).
 */
export async function POST(req: Request) {
  // Opposition (GPC, DNT, bouton de `/rgpd#audience`) relue avant tout calcul :
  // ni empreinte, ni décompte du plafond (qui garderait l'IP en mémoire).
  if (audienceOptOutFromHeaders(req.headers)) return ok({ recorded: 0 });

  const userAgent = req.headers.get("user-agent");
  if (isBotUserAgent(userAgent) || !isAudienceScriptRequest(req.headers, userAgent)) return ok({ recorded: 0 });

  const ip = requestClientIp(req);
  const throttled = throttleAudienceRequest(ip);
  if (throttled) return throttled;

  // Repli et purge entraînés par le trafic mesuré (ni opposition, ni robot, ni
  // plafond dépassé) : ces envois-là n'ont aucun effet de bord, même rares.
  maintainAudience();

  let body: unknown = null;
  try {
    body = await readJsonBody(req, SMALL_JSON_BODY_MAX_BYTES);
  } catch {
    return ok({ recorded: 0 });
  }

  const views = admitAudienceViews(ip, userAgent ?? "", parseAudienceBatch(body, siteHost()));
  if (views.length === 0) return ok({ recorded: 0 });
  try {
    return ok({ recorded: await recordAudienceViews({ ip, userAgent, views }) });
  } catch (error) {
    // Erreur imprévue : l'envoi est perdu, sans bruit chez le visiteur (un sel illisible ne lève pas).
    console.error("[audience] Pages vues écartées.", failureReason(error));
    return ok({ recorded: 0 });
  }
}

/** Nom d'hôte public du site (`APP_URL`) : un référent qui le porte est un accès direct. */
function siteHost(): string | null {
  const base = siteBaseUrl();
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return null;
  }
}
