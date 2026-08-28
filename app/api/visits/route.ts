import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, requestClientIp } from "@/lib/server/api-guard";
import { ok } from "@/lib/server/http";
import { recordSiteVisit, syncSiteVisitStatsToBot } from "@/lib/server/site-visits-service";
import type { RateLimitRule } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Plafond de **requêtes** par IP, distinct du plafond d'**insertions** appliqué
 * par le service. Celui-ci borne le travail fait avant même de savoir s'il y a
 * une visite à enregistrer : résolution de session et lecture de la fenêtre. Il
 * est large — un visiteur normal envoie deux pings par heure.
 */
const VISIT_REQUEST_RULE: RateLimitRule = {
  name: "site-visits-request",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Enregistre une visite du site. Appelé par `<VisitTracker />` à chaque
 * chargement de page ; le service regroupe les chargements d'une même fenêtre de
 * session, si bien qu'un rafraîchissement ne gonfle pas le compteur.
 *
 * Public par nécessité (les visiteurs anonymes comptent), et volontairement
 * silencieux : une erreur d'enregistrement renvoie `recorded: false` plutôt
 * qu'un statut d'échec, pour ne jamais faire remonter d'erreur dans la console
 * d'un visiteur.
 */
export async function POST(req: Request) {
  const ip = requestClientIp(req);
  const throttled = enforceRateLimit(VISIT_REQUEST_RULE, ip);
  if (throttled) return throttled;

  let path: unknown = "/";
  try {
    const body = (await req.json()) as { path?: unknown };
    path = body?.path;
  } catch {
    // Corps absent ou illisible : on enregistre quand même la visite, sur `/`.
  }

  try {
    const user = await getCurrentUser();
    const { recorded } = await recordSiteVisit({
      userId: user?.id ?? null,
      ip,
      userAgent: req.headers.get("user-agent"),
      path,
    });

    // Les compteurs n'ont bougé que si une visite a été créée : on ne réveille
    // le bot que dans ce cas, et au plus une fois par cadence.
    if (recorded) {
      void syncSiteVisitStatsToBot().catch(() => {
        // Meilleur effort, déjà dégradé côté bot-integration.
      });
    }

    return ok({ recorded });
  } catch {
    return ok({ recorded: false });
  }
}
