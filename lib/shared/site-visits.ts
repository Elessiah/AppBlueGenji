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
 * serveur avec un sel secret : ni l'IP ni le compte ne sont stockés, et
 * l'empreinte ne se renverse pas sans ce secret. Un visiteur connecté est
 * identifié par son compte (donc reconnu d'un appareil à l'autre) ; un visiteur
 * anonyme l'est par le couple IP + user-agent. Conséquence assumée : un même
 * humain compté anonyme puis connecté pèse deux visiteurs uniques.
 */

/** Durée pendant laquelle les chargements d'un même visiteur restent une seule visite. */
export const SITE_VISIT_WINDOW_MINUTES = 30;

/**
 * Durée de conservation du **détail** des visites (une ligne par visite : page,
 * heure, empreinte), en jours pleins.
 *
 * Au-delà, les jours révolus sont repliés en un compteur par jour
 * (`bg_site_visit_days`) puis effacés : la plus large fenêtre publiée est de
 * trente jours, le jour de plus garde cette fenêtre entière quelle que soit
 * l'heure du repli. Le registre des traitements cite cette constante.
 */
export const SITE_VISIT_DETAIL_RETENTION_DAYS = 31;

/**
 * Durée de conservation d'une **empreinte de visiteur** (`bg_site_visitors`),
 * comptée depuis sa **dernière visite**, en mois.
 *
 * Vingt-cinq mois : la durée que la CNIL retient pour les données de mesure
 * d'audience (lignes directrices du 17 septembre 2020). Au-delà, l'empreinte est
 * effacée par le repli du détail (`rollUpExpiredSiteVisits`) : le total des
 * visiteurs uniques est donc celui des vingt-cinq derniers mois, et non plus
 * « depuis la mise en service ». Le registre des traitements et `/rgpd` citent
 * cette constante.
 */
export const SITE_VISITOR_RETENTION_MONTHS = 25;

/**
 * Cookie qui retient l'**opposition** à la mesure d'audience, posé par le bouton
 * de `/rgpd#audience`. Il ne contient que la valeur `1` — aucun identifiant —, et
 * le serveur le relit lui-même : une visite refusée n'est ni envoyée par le
 * navigateur, ni enregistrée si elle arrive quand même.
 */
export const AUDIENCE_OPT_OUT_COOKIE = "bg_audience_optout";

/** Durée de vie du cookie d'opposition : treize mois, plafond CNIL d'un traceur. */
export const AUDIENCE_OPT_OUT_MAX_AGE_DAYS = 395;

/** Pourquoi une visite n'est pas mesurée : signal du navigateur, ou choix fait sur le site. */
export type AudienceOptOutReason = "GPC" | "DNT" | "CHOICE";

/** Un en-tête ou une propriété de signal vaut « oui » seulement pour `1` (ou `true`). */
function signalOn(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === "string" && value.trim() === "1";
}

/** Valeur d'un cookie dans une chaîne `Cookie` / `document.cookie`, ou `null`. */
export function readCookieValue(header: string | null | undefined, name: string): string | null {
  if (typeof header !== "string" || !header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/**
 * La visite doit-elle échapper à la mesure, et pourquoi ?
 *
 * Trois sources, dans l'ordre : **Global Privacy Control** (`Sec-GPC: 1`,
 * `navigator.globalPrivacyControl`), **Do Not Track** (`DNT: 1`,
 * `navigator.doNotTrack`), puis le **choix** fait sur `/rgpd#audience` (cookie
 * {@link AUDIENCE_OPT_OUT_COOKIE} à `1`). Un signal du navigateur l'emporte : il
 * ne se lève que depuis le navigateur, jamais depuis le site.
 */
export function audienceOptOutReason(signals: {
  gpc?: unknown;
  dnt?: unknown;
  cookie?: string | null;
}): AudienceOptOutReason | null {
  if (signalOn(signals.gpc)) return "GPC";
  if (signalOn(signals.dnt)) return "DNT";
  if (readCookieValue(signals.cookie, AUDIENCE_OPT_OUT_COOKIE) === "1") return "CHOICE";
  return null;
}

const OPT_OUT_STRENGTH: Record<AudienceOptOutReason, number> = { GPC: 3, DNT: 2, CHOICE: 1 };

/**
 * La plus forte de deux lectures d'opposition — GPC, puis DNT, puis le choix.
 * Sert à croiser ce que le serveur a lu dans les en-têtes avec ce que la page
 * lit dans le navigateur : un signal envoyé en en-tête sans être exposé à la
 * page (extension) ne doit pas être éclipsé par un simple cookie.
 */
export function strongerAudienceOptOut(
  a: AudienceOptOutReason | null,
  b: AudienceOptOutReason | null,
): AudienceOptOutReason | null {
  if (!a) return b;
  if (!b) return a;
  return OPT_OUT_STRENGTH[a] >= OPT_OUT_STRENGTH[b] ? a : b;
}

/** {@link audienceOptOutReason} lu sur les en-têtes d'une requête (côté serveur). */
export function audienceOptOutFromHeaders(headers: {
  get(name: string): string | null;
}): AudienceOptOutReason | null {
  return audienceOptOutReason({
    gpc: headers.get("sec-gpc"),
    dnt: headers.get("dnt"),
    cookie: headers.get("cookie"),
  });
}

/**
 * Chaîne `document.cookie` qui pose l'opposition — ou l'efface (`Max-Age=0`)
 * quand le visiteur revient sur son choix, pour ne pas garder un cookie qui ne
 * dit plus rien.
 */
export function audienceOptOutCookieString(optOut: boolean, secure: boolean): string {
  const maxAge = optOut ? AUDIENCE_OPT_OUT_MAX_AGE_DAYS * 24 * 60 * 60 : 0;
  return `${AUDIENCE_OPT_OUT_COOKIE}=${optOut ? "1" : ""}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

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
