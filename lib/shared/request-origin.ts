/**
 * Une requête vient-elle du site lui-même ?
 *
 * Posée d'abord sur les routes qui **ouvrent ou ferment une session**, puis
 * étendue à **toute écriture** sous `/api/` (`middleware.ts`), parce que
 * `SameSite=Lax` ne protège qu'à moitié les routes authentifiées : il refuse le
 * cookie à un site **tiers**, pas à un sous-domaine voisin du même domaine —
 * une requête *same-site*, que ce module refuse justement comme non maîtrisée.
 *
 * Les routes qui *posent* la session, elles, ne sont pas protégées du tout par
 * `SameSite` — elles n'ont besoin d'aucun cookie pour agir. Un site
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

/** Type de média d'un `Content-Type` (sans paramètres), en minuscules. */
function mediaTypeOf(contentType: string | null): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Le corps est-il **déclaré** en JSON ? `application/json`, tout type suffixé
 * `+json` (`application/reports+json`, rapports CSP de l'API Reporting) et
 * `application/csp-report` (rapports de l'ancienne directive `report-uri`).
 *
 * Aucun des trois n'est à la portée d'un formulaire HTML, qui ne sait envoyer
 * que `text/plain`, `application/x-www-form-urlencoded` ou
 * `multipart/form-data` ; un `fetch` d'un autre site qui en poserait un
 * déclencherait une requête préalable CORS, que le site ne satisfait pas.
 */
export function isJsonContentType(contentType: string | null): boolean {
  const mediaType = mediaTypeOf(contentType);
  return (
    mediaType === "application/json" ||
    mediaType === "application/csp-report" ||
    /^application\/[a-z0-9.+-]+\+json$/.test(mediaType)
  );
}

/**
 * Méthodes qui ne font qu'**écrire** : le contrôle de provenance ne vise
 * qu'elles. Une lecture (`GET`, `HEAD`, `OPTIONS`) n'a rien à défendre — les
 * rappels OAuth et le flux SSE en sont, et un site tiers ne lit de toute façon
 * pas la réponse.
 */
export function isWriteMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/**
 * Routes d'écriture **exemptées** du contrôle de provenance du middleware.
 *
 * Deux routes anonymes, qui ne font agir aucune session et ne lisent aucun
 * cookie : le collecteur CSP (`/api/csp-report`), dont les rapports sont émis
 * par le navigateur lui-même, avec une provenance qu'aucune norme ne fixe, et
 * le compteur de visites (`/api/visits`). Refuser l'un ou l'autre ne
 * protégerait rien et ferait perdre, en silence, un signal.
 */
export const PROVENANCE_EXEMPT_API_PATHS: readonly string[] = ["/api/csp-report", "/api/visits"];

/** La route d'écriture `pathname` doit-elle prouver sa provenance ? */
export function apiWriteNeedsProvenance(pathname: string, method: string): boolean {
  if (!pathname.startsWith("/api/") || !isWriteMethod(method)) return false;
  const path = pathname.replace(/\/+$/, "");
  return !PROVENANCE_EXEMPT_API_PATHS.includes(path);
}

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
    if (mediaTypeOf(signals.contentType) !== "application/json") return UNSUPPORTED_CONTENT_TYPE;

  }

  return null;
}
