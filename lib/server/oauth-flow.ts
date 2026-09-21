/**
 * L'aller-retour OAuth, écrit **une fois** pour les trois fournisseurs.
 *
 * Google, Discord et Blizzard ne diffèrent que par trois choses : l'URL
 * d'autorisation, l'échange du code contre un profil, et ce que ce profil
 * contient. Tout le reste — le jeton anti-CSRF, le cookie d'état, le filtrage de
 * la destination, le refus lisible quand la configuration manque, la différence
 * entre *se connecter* et *rattacher* — est identique, et identique est
 * précisément ce qu'il faut : trois copies auraient divergé sur le seul point où
 * la divergence ne se voit pas, la sécurité.
 *
 * Les routes (`app/api/auth/<slug>/start` et `/callback`) ne font donc qu'appeler
 * les deux fonctions ci-dessous avec leur fournisseur. Elles tiennent en dix
 * lignes, et ajouter une quatrième porte demain ne demande qu'un client et une
 * entrée dans {@link OAUTH_CLIENTS}.
 *
 * **Deux intentions, une seule mécanique.** `LOGIN` ouvre une session, `LINK`
 * rattache l'identité au compte déjà connecté. L'intention est **scellée à
 * l'aller** dans le cookie d'état, jamais relue dans l'URL du rappel : lue là,
 * elle serait choisie par l'appelant, et un `intent` retourné en `LOGIN`
 * transformerait un rattachement en changement de session — le joueur croyait
 * ajouter un moyen de connexion, il vient d'ouvrir celle de quelqu'un d'autre.
 */
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSession, getCurrentUser } from "@/lib/server/auth";
import {
  buildBlizzardAuthorizationUrl,
  fetchBlizzardUser,
} from "@/lib/server/blizzard-oauth";
import {
  buildDiscordAuthorizationUrl,
  discordAvatarUrl,
  fetchDiscordUser,
} from "@/lib/server/discord-oauth";
import {
  buildGoogleAuthorizationUrl,
  fetchGoogleUser,
  getAppBaseUrl,
} from "@/lib/server/google-oauth";
import { consumeOAuthState, saveOAuthState } from "@/lib/server/oauth-state";
import {
  createOrGetOAuthUser,
  linkOAuthIdentity,
  type OAuthIdentity,
} from "@/lib/server/account-identities";
import {
  OAUTH_PROVIDER_SLUGS,
  type OAuthIntent,
  type OAuthProvider,
} from "@/lib/shared/oauth-providers";
import { isLinkRefusal } from "@/lib/shared/account-connections";
import { DEFAULT_REDIRECT, safeRedirectPath } from "@/lib/shared/safe-redirect";

/** Où retombe un rattachement, réussi ou non. */
const PROFILE_PATH = "/profil";

type OAuthClient = {
  authorizationUrl(state: string): string;
  fetchIdentity(code: string): Promise<OAuthIdentity>;
};

const OAUTH_CLIENTS: Record<OAuthProvider, OAuthClient> = {
  GOOGLE: {
    authorizationUrl: buildGoogleAuthorizationUrl,
    async fetchIdentity(code) {
      const profile = await fetchGoogleUser(code);
      return {
        provider: "GOOGLE",
        subject: profile.sub,
        // Google ne donne aucun tag que le site ait à ranger : son nom
        // d'affichage ne sert qu'à proposer un pseudo à la création.
        handle: null,
        avatarUrl: profile.picture ?? null,
        displayName: profile.name ?? null,
      };
    },
  },
  DISCORD: {
    authorizationUrl: buildDiscordAuthorizationUrl,
    async fetchIdentity(code) {
      const user = await fetchDiscordUser(code);
      return {
        provider: "DISCORD",
        subject: user.id,
        // **Le pseudo, pas le nom d'affichage.** `username` est le tag stable
        // par lequel on retrouve quelqu'un sur Discord ; `global_name` est un
        // libellé décoratif, que deux comptes peuvent partager. C'est le
        // premier que la certification publie à l'arbitrage.
        handle: user.username,
        avatarUrl: discordAvatarUrl(user),
        displayName: user.global_name ?? user.username,
      };
    },
  },
  BLIZZARD: {
    authorizationUrl: buildBlizzardAuthorizationUrl,
    async fetchIdentity(code) {
      const user = await fetchBlizzardUser(code);
      return {
        provider: "BLIZZARD",
        subject: user.sub,
        handle: user.battletag ?? null,
        // Battle.net ne sert aucune photo de profil par l'`userinfo`.
        avatarUrl: null,
        displayName: user.battletag ?? null,
      };
    },
  },
};

/**
 * La configuration de ce fournisseur manque-t-elle ?
 *
 * Les clients lèvent `Missing <VAR>` quand une variable d'environnement n'est
 * pas réglée. On distingue ce cas d'une panne réseau parce que le joueur n'a
 * rien à réessayer : le bouton ne marchera pas tant que personne n'aura rempli
 * le `.env`, et lui dire « réessaie » serait lui mentir.
 */
function isMissingConfiguration(error: unknown): boolean {
  return (error as Error)?.message?.startsWith("Missing ") === true;
}

function loginFailure(base: string, provider: OAuthProvider, kind: string): NextResponse {
  const url = new URL("/connexion", base);
  url.searchParams.set("error", kind);
  url.searchParams.set("provider", OAUTH_PROVIDER_SLUGS[provider]);
  return NextResponse.redirect(url);
}

function linkFailure(base: string, provider: OAuthProvider, code: string): NextResponse {
  const url = new URL(PROFILE_PATH, base);
  url.searchParams.set("connection_error", code);
  url.searchParams.set("provider", OAUTH_PROVIDER_SLUGS[provider]);
  return NextResponse.redirect(url);
}

/**
 * Départ : pose l'état et envoie le navigateur chez le fournisseur.
 *
 * `intent=link` **exige une session ici**, et non au retour. Les deux contrôles
 * existent (voir {@link completeOAuth}), mais celui-ci a une valeur propre : il
 * évite de promener quelqu'un chez Discord pour lui annoncer au retour qu'il
 * n'était pas connecté.
 */
export async function startOAuth(req: NextRequest, provider: OAuthProvider): Promise<NextResponse> {
  const base = getAppBaseUrl(req.url);
  // Filtrée dès l'aller : rien d'étranger au site n'entre dans le cookie d'état.
  const redirectTo = safeRedirectPath(req.nextUrl.searchParams.get("redirect"));
  const intent: OAuthIntent = req.nextUrl.searchParams.get("intent") === "link" ? "LINK" : "LOGIN";

  if (intent === "LINK") {
    const user = await getCurrentUser();
    if (!user) return loginFailure(base, provider, "session");
  }

  const state = crypto.randomBytes(24).toString("hex");

  try {
    const authorizationUrl = OAUTH_CLIENTS[provider].authorizationUrl(state);
    await saveOAuthState({ provider, state, redirectTo, intent });
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    const missing = isMissingConfiguration(error);
    // **Un rattachement échoue sur `/profil`, pas sur `/connexion`.** Celui qui
    // clique « Rattacher » est connecté et vient de la page de son compte :
    // l'envoyer sur la page de connexion lui ferait croire que sa session a
    // sauté, et lui ferait perdre l'écran où il était. Seul le défaut de session
    // ci-dessus mène ailleurs, et pour cause.
    if (intent === "LINK") {
      return linkFailure(base, provider, missing ? "NOT_CONFIGURED" : "OAUTH_FAILED");
    }
    return loginFailure(base, provider, missing ? "not_configured" : "unavailable");
  }
}

/**
 * Retour : vérifie l'état, lit l'identité, puis ouvre une session ou rattache.
 *
 * Trois contrôles avant toute écriture, dans cet ordre :
 *
 * 1. le rappel porte bien un `code` et un `state` ;
 * 2. le cookie d'état existe, son `state` correspond, et il a été émis **pour ce
 *    fournisseur-ci** — sans quoi un état obtenu sur la porte Google serait
 *    recevable sur celle de Blizzard ;
 * 3. la destination est refiltrée : le cookie n'est pas signé, il ne fait pas
 *    foi (`lib/shared/safe-redirect.ts`).
 */
export async function completeOAuth(req: NextRequest, provider: OAuthProvider): Promise<NextResponse> {
  const base = getAppBaseUrl(req.url);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  // Le cookie est consommé **quoi qu'il arrive** : un état qui ne sert pas est
  // un état qui a échoué, et le laisser en place le rendrait rejouable dix
  // minutes durant.
  const saved = await consumeOAuthState();

  if (!code || !state) return loginFailure(base, provider, "params");
  if (!saved || saved.state !== state || saved.provider !== provider) {
    return loginFailure(base, provider, "state");
  }

  let identity: OAuthIdentity;
  try {
    identity = await OAUTH_CLIENTS[provider].fetchIdentity(code);
  } catch (error) {
    const missing = isMissingConfiguration(error);
    return saved.intent === "LINK"
      ? linkFailure(base, provider, missing ? "NOT_CONFIGURED" : "OAUTH_FAILED")
      : loginFailure(base, provider, missing ? "not_configured" : "oauth");
  }

  if (saved.intent === "LINK") {
    // Relue ici et pas seulement au départ : dix minutes séparent les deux, et
    // la session a pu expirer ou changer entre-temps. Rattacher sur la foi du
    // seul cookie d'état poserait une porte d'entrée sur un compte que plus rien
    // ne prouve être celui de l'appelant.
    const user = await getCurrentUser();
    if (!user) return loginFailure(base, provider, "session");

    try {
      await linkOAuthIdentity(user.id, identity);
    } catch (error) {
      // **Seuls les refus nommés voyagent.** `linkOAuthIdentity` ne lève pas que
      // ses trois refus : tout ce que `mysql2` fait remonter le traverse, et ce
      // message-ci finit dans une URL — donc dans l'historique du navigateur, le
      // `Referer` de la requête suivante et les journaux de chaque relais. Le
      // joueur, lui, ne verrait rien : le registre français retombe sur sa
      // phrase générique, ce qui rend la fuite parfaitement discrète.
      const message = (error as Error).message;
      return linkFailure(base, provider, isLinkRefusal(message) ? message : "LINK_FAILED");
    }

    const url = new URL(PROFILE_PATH, base);
    url.searchParams.set("connected", OAUTH_PROVIDER_SLUGS[provider]);
    return NextResponse.redirect(url);
  }

  try {
    const userId = await createOrGetOAuthUser(identity);
    await createSession(userId);
  } catch {
    return loginFailure(base, provider, "oauth");
  }

  return NextResponse.redirect(new URL(safeRedirectPath(saved.redirectTo ?? DEFAULT_REDIRECT), base));
}
