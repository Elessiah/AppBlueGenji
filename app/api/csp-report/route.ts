import { CSP_REPORT_RULE, enforceRateLimit, requestClientIp } from "@/lib/server/api-guard";
import { logCspViolations, parseCspReport } from "@/lib/server/csp-reports";

export const dynamic = "force-dynamic";

/**
 * Collecte les violations de la politique de sécurité du contenu.
 *
 * Cité par `report-uri` dans la politique elle-même, donc appelé par le
 * **navigateur**, sans session ni jeton : la route est publique par
 * construction, et n'a aucun moyen de distinguer un vrai rapport d'un corps
 * fabriqué. Elle est donc écrite pour que cela n'ait pas d'importance — elle
 * ne lit que trois champs, n'écrit rien en base, et ne journalise qu'une ligne
 * par cause et par heure (voir `csp-reports`).
 *
 * Réponse **toujours 204**, y compris sur un corps illisible : un navigateur
 * ne sait rien faire d'une erreur ici, et un statut d'échec n'apprendrait qu'à
 * celui qui sonde la route. Le plafond de débit est la seule vraie borne.
 */
export async function POST(req: Request) {
  const throttled = enforceRateLimit(CSP_REPORT_RULE, requestClientIp(req));
  if (throttled) return throttled;

  try {
    logCspViolations(parseCspReport(await req.json()));
  } catch {
    // Corps absent, tronqué ou pas du JSON : il n'y a rien à en tirer et rien
    // à dire à l'expéditeur.
  }

  return new Response(null, { status: 204 });
}
