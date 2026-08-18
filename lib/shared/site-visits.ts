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

/** Nombre de proxys de confiance devant l'application (nginx seul = 1). */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * IP du client d'après `X-Forwarded-For`, en ne faisant confiance qu'aux proxys
 * qu'on héberge.
 *
 * L'en-tête se lit `client, proxy1, proxy2` : chaque relais **ajoute** à droite
 * l'adresse dont il a reçu la requête. La partie gauche est donc écrite par le
 * client et falsifiable à volonté — un visiteur qui envoie son propre
 * `X-Forwarded-For` obtiendrait une identité neuve à chaque requête. On compte
 * donc depuis la droite : avec `hops = 1` (un nginx devant l'app), la bonne
 * valeur est la dernière, celle que le proxy vient d'ajouter.
 *
 * @param value En-tête `X-Forwarded-For` brut.
 * @param hops Nombre de relais de confiance ; ramené à au moins 1.
 * @returns L'IP retenue, ou `null` si l'en-tête est absent ou vide — l'empreinte
 * retombe alors sur `unknown-ip`, ce qui regroupe ces visiteurs sans rien casser.
 */
export function clientIpFromForwardedFor(
  value: string | null | undefined,
  hops: number = DEFAULT_TRUSTED_PROXY_HOPS,
): string | null {
  if (typeof value !== "string") return null;

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) return null;

  const trusted = Number.isFinite(hops) ? Math.max(1, Math.floor(hops)) : DEFAULT_TRUSTED_PROXY_HOPS;
  // Moins d'entrées que de relais annoncés : la chaîne est plus courte que
  // prévu, on prend la plus à gauche qui reste — jamais hors bornes.
  const index = Math.max(0, entries.length - trusted);
  return entries[index];
}

/**
 * Nombre de proxys de confiance configuré (`TRUSTED_PROXY_HOPS`), replié sur
 * {@link DEFAULT_TRUSTED_PROXY_HOPS} si la valeur est absente ou aberrante.
 */
export function parseTrustedProxyHops(raw: string | undefined | null): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TRUSTED_PROXY_HOPS;
}
