import { headers } from "next/headers";
import { DOCUMENT_REQUEST_HEADER, splitLocalePrefix } from "@/lib/shared/locales";

/**
 * Le client qui demande affiche-t-il **déjà** la mise en page de `segment`
 * (`/profil`, `/signalements`) ? Vrai pour un `router.refresh()` ou une
 * navigation d'un signalement à l'autre : la requête vient du routeur
 * (`DOCUMENT_REQUEST_HEADER` à `"0"`, posé par le middleware) et sa page
 * d'origine (`Referer`, même origine : `Referrer-Policy:
 * strict-origin-when-cross-origin` le garde entier) est sous ce segment.
 *
 * Une mise en page s'en sert pour ne pas renvoyer un dictionnaire que le
 * client tient déjà (revue de performance du lot 9-2). Dans le doute
 * (chargement complet, `Referer` absent, illisible ou d'une autre origine) :
 * faux — le dictionnaire part, comme avant.
 */
export async function clientShowsSegment(segment: string): Promise<boolean> {
  const requestHeaders = await headers();
  if (requestHeaders.get(DOCUMENT_REQUEST_HEADER) !== "0") return false;
  const referer = requestHeaders.get("referer");
  if (!referer) return false;
  let origin: URL;
  try {
    origin = new URL(referer);
  } catch {
    return false;
  }
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (host && origin.host !== host) return false;
  const { path } = splitLocalePrefix(origin.pathname);
  return path === segment || path.startsWith(`${segment}/`);
}
