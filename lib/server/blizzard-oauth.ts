/**
 * Connexion par OAuth Blizzard (Battle.net).
 *
 * **Ce qu'elle apporte, et pourquoi elle vaut le détour** : le BattleTag. Le
 * site fait jouer à Overwatch, et `bg_users.overwatch_battletag` était jusqu'ici
 * une chaîne libre — un joueur qui se trompe d'un chiffre n'est pas ajoutable en
 * jeu, et personne ne peut le lui dire. Entrer par Blizzard fait écrire ce
 * champ par Blizzard.
 *
 * **Portée demandée : `openid`, et c'est tout.** L'`userinfo` rend alors
 * `{ sub, id, battletag }` — un identifiant et un tag, rien d'autre. Battle.net
 * ne donne **aucune adresse**, ce qui tombe bien : le site n'en veut pas.
 *
 * **Une seule origine, sauf en Chine.** `oauth.battle.net` sert les quatre
 * régions occidentales ; la Chine a sa propre infrastructure
 * (`oauth.battlenet.com.cn`), qui ne partage ni les comptes ni les jetons. D'où
 * `BLIZZARD_REGION`, qui ne départage que ces deux mondes — aucun autre réglage
 * régional n'existe côté OAuth, et en inventer un donnerait une variable dont la
 * valeur ne changerait rien.
 */

const GLOBAL_OAUTH_BASE = "https://oauth.battle.net";
const CHINA_OAUTH_BASE = "https://oauth.battlenet.com.cn";
const SCOPE = "openid";

export type BlizzardUserInfo = {
  /** Identifiant stable du compte Battle.net. */
  sub: string;
  id?: number;
  /** BattleTag complet, « Pseudo#1234 ». Absent d'un compte qui n'en a pas. */
  battletag?: string | null;
};

/**
 * Racine OAuth à interroger.
 *
 * Toute valeur autre que `cn` retombe sur l'origine mondiale : la variable sert
 * à *sortir* du cas par défaut, pas à l'énumérer, et une faute de frappe ne doit
 * pas casser la connexion de tout le monde.
 */
export function getBlizzardOAuthBase(): string {
  return process.env.BLIZZARD_REGION?.trim().toLowerCase() === "cn" ? CHINA_OAUTH_BASE : GLOBAL_OAUTH_BASE;
}

function getBlizzardClientId(): string {
  const value = process.env.BLIZZARD_CLIENT_ID?.trim();
  if (!value) throw new Error("Missing BLIZZARD_CLIENT_ID");
  return value;
}

function getBlizzardClientSecret(): string {
  const value = process.env.BLIZZARD_CLIENT_SECRET?.trim();
  if (!value) throw new Error("Missing BLIZZARD_CLIENT_SECRET");
  return value;
}

export function getBlizzardRedirectUri(): string {
  const explicit = process.env.BLIZZARD_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) throw new Error("Missing BLIZZARD_REDIRECT_URI or APP_URL");
  return `${appUrl.replace(/\/$/, "")}/api/auth/blizzard/callback`;
}

export function buildBlizzardAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getBlizzardClientId(),
    redirect_uri: getBlizzardRedirectUri(),
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${getBlizzardOAuthBase()}/authorize?${params.toString()}`;
}

export async function fetchBlizzardUser(code: string): Promise<BlizzardUserInfo> {
  const base = getBlizzardOAuthBase();
  // Battle.net attend les identifiants du client en **HTTP Basic**, et non dans
  // le corps de la requête : c'est la forme documentée, et la seule que
  // l'émetteur de jetons accepte sans condition.
  const credentials = Buffer.from(`${getBlizzardClientId()}:${getBlizzardClientSecret()}`).toString("base64");

  const tokenResponse = await fetch(`${base}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getBlizzardRedirectUri(),
    }),
    cache: "no-store",
  });

  if (!tokenResponse.ok) throw new Error("BLIZZARD_TOKEN_EXCHANGE_FAILED");

  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("BLIZZARD_ACCESS_TOKEN_MISSING");

  const userResponse = await fetch(`${base}/userinfo`, {
    headers: { authorization: `Bearer ${tokenJson.access_token}` },
    cache: "no-store",
  });

  if (!userResponse.ok) throw new Error("BLIZZARD_USERINFO_FAILED");

  const userJson = (await userResponse.json()) as BlizzardUserInfo;
  if (!userJson.sub || typeof userJson.sub !== "string") throw new Error("BLIZZARD_USERINFO_INVALID");

  return userJson;
}
