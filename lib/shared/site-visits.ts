/**
 * Fréquentation du site — logique pure (importable partout).
 *
 * Deux nombres sont suivis :
 * - **visites totales** : une visite = une arrivée d'un visiteur sur le site.
 *   Deux chargements de page du même visiteur à moins de
 *   {@link SITE_VISIT_WINDOW_MINUTES} minutes d'intervalle comptent pour une
 *   seule visite (fenêtre de session), sinon un simple rafraîchissement gonflerait
 *   le compteur.
 * - **visiteurs uniques** : nombre d'empreintes de visiteur distinctes.
 *
 * L'empreinte est dérivée de {@link visitorIdentitySource} puis hachée côté
 * serveur : aucune IP n'est jamais stockée en clair. Un visiteur connecté est
 * identifié par son compte (donc reconnu d'un appareil à l'autre) ; un visiteur
 * anonyme l'est par le couple IP + user-agent. Conséquence assumée : un même
 * humain compté anonyme puis connecté pèse deux visiteurs uniques.
 */

/** Durée pendant laquelle les chargements d'un même visiteur restent une seule visite. */
export const SITE_VISIT_WINDOW_MINUTES = 30;

/** Longueur maximale d'un chemin stocké (aligné sur la colonne SQL). */
export const MAX_VISIT_PATH_LENGTH = 191;

/**
 * Ramène une entrée client quelconque à un chemin de page exploitable.
 *
 * Tolère une URL complète (`location.href`), une query string, un fragment, des
 * doublons de `/` ou une valeur absente — le repli est toujours `/`, de sorte
 * qu'une visite ne soit jamais perdue pour un chemin mal formé.
 */
export function normalizeVisitPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";

  let path = raw.trim();
  if (!path) return "/";

  // URL absolue : on ne garde que le chemin (le client peut envoyer `location.href`).
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(path);
  if (scheme) {
    const afterScheme = path.slice(scheme[0].length);
    const firstSlash = afterScheme.indexOf("/");
    path = firstSlash === -1 ? "/" : afterScheme.slice(firstSlash);
  }

  path = path.split("?")[0].split("#")[0];
  path = path.replace(/\s+/g, "");
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");

  if (path.length > MAX_VISIT_PATH_LENGTH) {
    path = path.slice(0, MAX_VISIT_PATH_LENGTH);
  }
  // `/tournois/` et `/tournois` sont la même page.
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  return path || "/";
}

/**
 * Chaîne d'identité d'un visiteur, **avant hachage**.
 *
 * Un compte connecté prime sur l'empreinte réseau : c'est ce qui donne un
 * « visiteur unique » au sens d'un utilisateur, et non d'un navigateur.
 */
export function visitorIdentitySource(input: {
  userId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
}): string {
  const { userId } = input;
  if (typeof userId === "number" && Number.isInteger(userId) && userId > 0) {
    return `u:${userId}`;
  }

  const ip = (input.ip ?? "").trim() || "unknown-ip";
  const userAgent = (input.userAgent ?? "").trim() || "unknown-ua";
  return `a:${ip}|${userAgent}`;
}

/**
 * Première IP d'un en-tête `X-Forwarded-For` (`client, proxy1, proxy2`).
 *
 * Renvoie `null` si l'en-tête est absent ou vide : l'empreinte retombe alors sur
 * `unknown-ip`, ce qui regroupe ces visiteurs mais ne fait planter aucun report.
 */
export function parseForwardedIp(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  for (const candidate of value.split(",")) {
    const ip = candidate.trim();
    if (ip) return ip;
  }
  return null;
}
