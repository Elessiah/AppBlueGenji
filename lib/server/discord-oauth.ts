/**
 * Connexion par OAuth Discord.
 *
 * **À ne pas confondre avec le code à six chiffres** (`/api/auth/discord/request`
 * et `/verify`), qui reste en place et qui sert un autre cas : le joueur *déjà
 * présent sur le serveur BlueGenji*, à qui le bot sait écrire en message privé.
 * Les deux chemins aboutissent au même endroit — `createOrGetDiscordUser`, donc
 * le même compte, le même `discord_id`, le même **tag certifié**.
 *
 * **Pourquoi la certification est acquise ici.** La certification demande une
 * preuve que le compte Discord revendiqué appartient bien au joueur
 * (`lib/shared/discord-identity.ts`). Un aller-retour OAuth mené jusqu'au bout
 * *est* cette preuve, et une meilleure que le code : c'est Discord lui-même qui
 * nomme l'identifiant et le pseudo, là où le code ne fait que prouver l'accès
 * aux messages privés d'un identifiant que le site avait résolu de son côté. Le
 * pseudo relu ici n'est donc jamais celui que le client renvoie — il ne renvoie
 * rien.
 *
 * **Portée demandée : `identify`, et c'est tout.** Ni `email` (plus rien ne
 * rattache un compte par son adresse), ni `guilds` (le site n'a pas à savoir sur
 * quels serveurs va le joueur — et la présence sur le nôtre se constate déjà,
 * quand elle sert, par le bot). La réponse d'`identify` porte l'identifiant, le
 * pseudo et l'avatar, ce qui est exactement ce que le compte du site retient.
 */

const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const USER_URL = "https://discord.com/api/users/@me";
const SCOPE = "identify";
/** Discord sert les avatars depuis son CDN ; la photo est copiée, jamais relayée. */
const CDN_URL = "https://cdn.discordapp.com";

export type DiscordUserInfo = {
  id: string;
  /** Pseudo Discord (l'« username » du nouveau système, sans discriminant). */
  username: string;
  /** Nom d'affichage, quand le compte en a choisi un. */
  global_name?: string | null;
  /** Empreinte de l'avatar, à composer avec l'identifiant pour obtenir l'URL. */
  avatar?: string | null;
};

/**
 * L'application Discord utilisée pour la connexion.
 *
 * **Deux noms, et pas trois.** `DISCORD_AUTH_CLIENT_ID` est celui qu'on règle :
 * il dit *à quoi sert* l'identifiant, là où `DISCORD_BOT_CLIENT_ID` — documenté
 * comme celui du lien d'invitation du bot — ne le dirait que par un repli qu'il
 * faut connaître. Ce repli reste, parce qu'en pratique c'est la **même**
 * application qui invite le bot et ouvre les sessions : un seul écran de
 * consentement au nom de BlueGenji, une seule application à surveiller, et une
 * installation qui n'a réglé que la variable du bot continue de fonctionner.
 *
 * Poser `DISCORD_AUTH_CLIENT_ID` permet d'en séparer une seconde le jour où le
 * besoin s'en présente, sans rien changer ailleurs.
 */
export function getDiscordClientId(): string {
  const value =
    process.env.DISCORD_AUTH_CLIENT_ID?.trim() || process.env.DISCORD_BOT_CLIENT_ID?.trim();
  if (!value) throw new Error("Missing DISCORD_AUTH_CLIENT_ID");
  return value;
}

function getDiscordClientSecret(): string {
  const value = process.env.DISCORD_CLIENT_SECRET?.trim();
  if (!value) throw new Error("Missing DISCORD_CLIENT_SECRET");
  return value;
}

export function getDiscordRedirectUri(): string {
  const explicit = process.env.DISCORD_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) throw new Error("Missing DISCORD_REDIRECT_URI or APP_URL");
  return `${appUrl.replace(/\/$/, "")}/api/auth/discord/callback`;
}

export function buildDiscordAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getDiscordClientId(),
    redirect_uri: getDiscordRedirectUri(),
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * URL de l'avatar Discord, ou `null`.
 *
 * Elle ne sert qu'à être **copiée** chez nous à la connexion, comme la photo
 * Google : `visibleAvatarUrl` refuse toute origine étrangère à la sortie, et un
 * `cdn.discordapp.com` rangé en base annoncerait l'IP de chaque visiteur à
 * Discord, à chaque affichage.
 */
export function discordAvatarUrl(user: DiscordUserInfo): string | null {
  if (!user.avatar) return null;
  // **Toujours `.png`, y compris pour une empreinte `a_` (avatar animé).**
  //
  // Demander le `.gif` que Discord sert pour celles-ci condamnait la copie :
  // `fetchRemoteImage` accepte bien le GIF, mais `storeImageBuffer` ne connaît
  // que PNG, JPEG et WebP (`ALLOWED_MIME`) et lève `IMAGE_FORMAT_INVALID`. Comme
  // `importRemoteAvatar` avale tout et rend `null`, tout compte à avatar animé
  // restait **sans photo** — sans erreur, sans journal, et en réessayant à
  // chaque connexion pour échouer à l'identique. La branche ne servait donc que
  // les comptes qu'elle empêchait d'aboutir.
  //
  // Le CDN rend la même empreinte en image fixe sous `.png`, et c'est de toute
  // façon ce qui serait stocké : ce qu'on range est un fichier reconverti par
  // `sharp`, jamais une animation.
  return `${CDN_URL}/avatars/${user.id}/${user.avatar}.png?size=256`;
}

export async function fetchDiscordUser(code: string): Promise<DiscordUserInfo> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getDiscordClientId(),
      client_secret: getDiscordClientSecret(),
      grant_type: "authorization_code",
      code,
      redirect_uri: getDiscordRedirectUri(),
    }),
    cache: "no-store",
  });

  if (!tokenResponse.ok) throw new Error("DISCORD_TOKEN_EXCHANGE_FAILED");

  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("DISCORD_ACCESS_TOKEN_MISSING");

  const userResponse = await fetch(USER_URL, {
    headers: { authorization: `Bearer ${tokenJson.access_token}` },
    cache: "no-store",
  });

  if (!userResponse.ok) throw new Error("DISCORD_USERINFO_FAILED");

  const userJson = (await userResponse.json()) as DiscordUserInfo;
  // L'identifiant est ce qui identifie le compte : sans lui, il n'y a rien à
  // rattacher, et une ligne écrite sur un identifiant vide serait pire que rien.
  if (!userJson.id || !/^\d{5,32}$/.test(userJson.id)) throw new Error("DISCORD_USERINFO_INVALID");

  return userJson;
}
