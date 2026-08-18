import { getCurrentUser } from "@/lib/server/auth";
import { ok } from "@/lib/server/http";
import { recordSiteVisit, syncSiteVisitStatsToBot } from "@/lib/server/site-visits-service";
import { clientIpFromForwardedFor, parseTrustedProxyHops } from "@/lib/shared/site-visits";

export const dynamic = "force-dynamic";

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
      ip:
        clientIpFromForwardedFor(
          req.headers.get("x-forwarded-for"),
          parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
        ) ?? req.headers.get("x-real-ip"),
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
