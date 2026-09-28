/**
 * Une requête qui **ouvre ou ferme une session** vient-elle du site lui-même ?
 *
 * `SameSite=Lax` protège les routes authentifiées : un site tiers ne peut pas y
 * faire porter le cookie de la victime. Il ne protège **pas** celles qui
 * *posent* la session — elles n'ont besoin d'aucun cookie pour agir. Un site
 * tiers soumettait donc, en navigation de premier niveau, un
 * `<form method=post enctype=text/plain>` dont le nom de champ reconstitue un
 * JSON valide (`{"credential":"<jeton de l'attaquant>","x":"` + `=` + `"}`) :
 * `req.json()` l'acceptait sans regarder le `Content-Type`, la réponse posait
 * `bg_session`, et la victime se retrouvait connectée **au compte de
 * l'attaquant** — où elle rattachait ensuite ses propres identités. Même
 * mécanisme pour déconnecter n'importe qui.
 *
 * Deux contrôles, indépendants, et chacun suffit contre ce formulaire :
 *
 * - **la provenance** : `Sec-Fetch-Site` quand le navigateur le pose (tous les
 *   navigateurs actuels), sinon `Origin`, comparé aux hôtes du site. Une
 *   requête qui ne porte **ni l'un ni l'autre** n'est pas refusée : aucun
 *   navigateur n'omet les deux sur un `POST` inter-sites, et un client hors
 *   navigateur n'a pas de cookie de victime à exploiter ;
 * - **le type du corps**, pour les routes qui en lisent un : un formulaire HTML
 *   ne sait pas envoyer `application/json`, et un `fetch` d'un autre site qui le
 *   ferait déclencherait une requête préalable CORS, que le site ne satisfait
 *   pas.
 */

/** Refus : la requête vient d'un autre site. */
export const CROSS_SITE_REQUEST = "CROSS_SITE_REQUEST";

/** Refus : le corps n'est pas déclaré en JSON. */
export const UNSUPPORTED_CONTENT_TYPE = "UNSUPPORTED_CONTENT_TYPE";

export type RequestOriginRefusal = typeof CROSS_SITE_REQUEST | typeof UNSUPPORTED_CONTENT_TYPE;

export interface RequestOriginSignals {
  /** En-tête `Sec-Fetch-Site`, ou `null`. */
  secFetchSite: string | null;
  /** En-tête `Origin`, ou `null`. */
  origin: string | null;
  /** En-tête `Content-Type`, ou `null`. */
  contentType: string | null;
  /**
   * Hôtes (`nom[:port]`, en minuscules) sous lesquels le site est servi : celui
   * d'`APP_URL`, et celui que la requête a elle-même visé.
   */
  siteHosts: readonly string[];
}

/**
 * `Sec-Fetch-Site` admis. `same-site` est refusé : il couvre un sous-domaine
 * voisin, que le site ne contrôle pas forcément. `none` est une navigation
 * lancée par l'utilisateur lui-même (barre d'adresse, favori).
 */
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

/** Hôte (`nom[:port]`) d'une origine, ou `null` si elle est illisible. */
function originHost(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * La requête vient-elle du site ? `null` si oui, le code du refus sinon.
 *
 * Pure : les en-têtes sont lus par l'appelant (`lib/server/request-origin.ts`).
 */
export function requestOriginRefusal(
  signals: RequestOriginSignals,
  options: { requireJson: boolean },
): RequestOriginRefusal | null {
  const fetchSite = signals.secFetchSite?.trim().toLowerCase() || null;
  if (fetchSite !== null) {
    if (!ALLOWED_FETCH_SITES.has(fetchSite)) return CROSS_SITE_REQUEST;
  } else if (signals.origin !== null) {
    // `Origin: null` : document sandboxé, redirection inter-sites, `data:`…
    // Rien de tout cela n'est le site.
    const host = originHost(signals.origin.trim());
    const hosts = new Set(signals.siteHosts.map((h) => h.toLowerCase()));
    if (host === null || !hosts.has(host)) return CROSS_SITE_REQUEST;
  }

  if (options.requireJson) {
    const mediaType = (signals.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (mediaType !== "application/json") return UNSUPPORTED_CONTENT_TYPE;
  }

  return null;
}
