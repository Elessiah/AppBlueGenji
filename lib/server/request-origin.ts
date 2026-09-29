import type { NextResponse } from "next/server";

import { fail, type ApiError } from "@/lib/server/http";
import { siteBaseUrl } from "@/lib/server/site-url";
import {
  CROSS_SITE_REQUEST,
  requestOriginRefusal,
} from "@/lib/shared/request-origin";

/**
 * Hôtes sous lesquels le site est servi, pour cette requête.
 *
 * `APP_URL` d'abord — c'est le nom public. Puis l'hôte que la requête a visé
 * (`Host`, `X-Forwarded-Host` quand un relais le pose) : en développement, ou
 * sur une machine servie sous plusieurs noms, `APP_URL` peut ne pas être réglée
 * ou ne pas être celui qu'on a tapé. Ces en-têtes ne donnent rien à un tiers :
 * c'est le navigateur de la **victime** qui les écrit, avec l'hôte du site.
 */
function siteHosts(req: Request): string[] {
  const hosts: string[] = [];
  const base = siteBaseUrl();
  if (base) {
    try {
      hosts.push(new URL(base).host);
    } catch {
      // `APP_URL` illisible : les en-têtes suffisent.
    }
  }
  for (const header of ["host", "x-forwarded-host"]) {
    const value = req.headers.get(header);
    if (value) hosts.push(...value.split(",").map((h) => h.trim()).filter(Boolean));
  }
  try {
    hosts.push(new URL(req.url).host);
  } catch {
    // URL relative (tests) : sans objet.
  }
  return hosts;
}

/**
 * Refuse une requête venue d'un autre site (voir `lib/shared/request-origin.ts`).
 * Rend la réponse à retourner telle quelle, ou `null` si la requête peut
 * continuer.
 *
 * Le middleware l'applique à **toute écriture** sous `/api/` ; les routes qui
 * ouvrent ou ferment une session la reposent en plus, pour le contrôle du type
 * du corps et pour ne pas dépendre du périmètre du middleware.
 *

 * À poser **en toute première instruction** des routes concernées, avant tout
 * plafond de débit : une requête forgée ne doit pas consommer le quota d'une IP
 * — ni, surtout, envoyer un message privé.
 *
 * `requireJson` pour les routes qui lisent un corps : c'est lui qui ferme le
 * formulaire `enctype=text/plain` sur un navigateur qui ne pose ni
 * `Sec-Fetch-Site` ni `Origin`.
 */
export function rejectCrossSiteRequest(
  req: Request,
  options: { requireJson: boolean },
): NextResponse<ApiError> | null {
  const refusal = requestOriginRefusal(
    {
      secFetchSite: req.headers.get("sec-fetch-site"),
      origin: req.headers.get("origin"),
      contentType: req.headers.get("content-type"),
      siteHosts: siteHosts(req),
    },
    options,
  );
  if (refusal === null) return null;
  return fail(refusal, refusal === CROSS_SITE_REQUEST ? 403 : 415);
}
