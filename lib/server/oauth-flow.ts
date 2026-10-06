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
import { AccountSuspendedError } from "@/lib/server/account-suspensions";
import {
  SUSPENSION_NOTICE_COOKIE,
  SUSPENSION_NOTICE_COOKIE_MAX_AGE_SECONDS,
  encodeSuspensionNotice,
} from "@/lib/shared/account-suspension";
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
import { consumeOAuthState, saveOAuthState, type OAuthStatePayload } from "@/lib/server/oauth-state";
import {
  createOrGetOAuthUser,
  linkOAuthIdentity,
  type OAuthIdentity,
  type OAuthLinkOutcome,
} from "@/lib/server/account-identities";
import {
  OAUTH_LOCALE_PARAM,
  OAUTH_PROVIDER_SLUGS,
  type OAuthIntent,
  type OAuthProvider,
} from "@/lib/shared/oauth-providers";
import { isLinkRefusal } from "@/lib/shared/account-connections";
import {
  DEFAULT_REDIRECT,
  loginDestination,
  sealedReturnLocale,
  sealedReturnPath,
} from "@/lib/shared/safe-redirect";
import { DEFAULT_LOCALE, isLocale, localeHref, type Locale } from "@/lib/shared/locales";
import { TERMS_REQUIRED } from "@/lib/shared/terms-of-use";

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
        // Google ne donne aucun tag que le site ait à ranger, et son nom
        // d'affichage — un nom réel, le plus souvent — n'est pas repris :
        // le compte naît sous un pseudo neutre (`createOrGetGoogleUser`).
        handle: null,
        avatarUrl: profile.picture ?? null,
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
        // premier que le site enregistre, et que le joueur peut ensuite
        // certifier pour l'ouvrir à l'arbitrage.
        handle: user.username,
        avatarUrl: discordAvatarUrl(user),
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

/**
 * Retour sur la page de connexion, **dans la langue du départ** : `/en/connexion`
 * pour qui est parti de la page anglaise (lot 6). Sans cookie d'état lisible
 * (expiré, navigateur qui l'isole), la langue n'est plus connue : le français.
 */
function loginFailure(base: string, provider: OAuthProvider, kind: string, locale: Locale = DEFAULT_LOCALE): NextResponse {
  const url = new URL(localeHref("/connexion", locale), base);
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
  const requestedLocale = req.nextUrl.searchParams.get(OAUTH_LOCALE_PARAM);
  const locale: Locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  // Filtrée dès l'aller : rien d'étranger au site n'entre dans le cookie d'état.
  // Scellée **dans la langue du départ** (`/en/…`, lot 6) : le cookie ne porte
  // pas de champ de plus, la langue se relit dans la destination au retour.
  const redirectTo = sealedReturnPath(req.nextUrl.searchParams.get("redirect"), locale);
  const intent: OAuthIntent = req.nextUrl.searchParams.get("intent") === "link" ? "LINK" : "LOGIN";
  const termsAccepted = req.nextUrl.searchParams.get("terms") === "1";

  if (intent === "LINK") {
    const user = await getCurrentUser();
    if (!user) return loginFailure(base, provider, "session", locale);
  }

  const state = crypto.randomBytes(24).toString("hex");

  try {
    const authorizationUrl = OAUTH_CLIENTS[provider].authorizationUrl(state);
    await saveOAuthState({ provider, state, redirectTo, intent, termsAccepted });
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
    return loginFailure(base, provider, missing ? "not_configured" : "unavailable", locale);
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

  // Un rattachement lancé depuis `/profil` revient sur `/profil`, même quand il
  // échoue avant la lecture de l'identité — annulé chez le fournisseur (rappel
  // sans `code`), ou revenu avec un état qui ne correspond pas. L'intention est
  // lue **dans le cookie**, jamais dans l'URL, et seulement s'il a été émis pour
  // cette porte-ci : sinon rien ne dit qu'il s'agissait d'un rattachement, et la
  // page de connexion reste la seule destination honnête.
  const linking = saved?.intent === "LINK" && saved.provider === provider;
  // Langue du départ, relue dans la destination scellée (jamais dans l'URL du
  // rappel, fixée chez le fournisseur) ; sans cookie, le français.
  const locale = sealedReturnLocale(saved?.redirectTo);
  if (!code || !state) {
    return linking ? linkFailure(base, provider, "LINK_CANCELLED") : loginFailure(base, provider, "params", locale);
  }
  if (saved?.state !== state || saved.provider !== provider) {
    return linking ? linkFailure(base, provider, "LINK_STATE_MISMATCH") : loginFailure(base, provider, "state", locale);
  }

  let identity: OAuthIdentity;
  try {
    identity = await OAUTH_CLIENTS[provider].fetchIdentity(code);
  } catch (error) {
    return identityFailure(base, provider, saved.intent, error, locale);
  }

  if (saved.intent === "LINK") return completeLink(base, provider, identity);
  return completeLogin(base, provider, identity, saved, locale);
}

/** Lecture de l'identité refusée par le fournisseur (ou configuration absente). */
function identityFailure(
  base: string,
  provider: OAuthProvider,
  intent: OAuthIntent,
  error: unknown,
  locale: Locale,
): NextResponse {
  const missing = isMissingConfiguration(error);
  if (intent === "LINK") {
    return linkFailure(base, provider, missing ? "NOT_CONFIGURED" : "OAUTH_FAILED");
  }
  return loginFailure(base, provider, missing ? "not_configured" : "oauth", locale);
}

/** Retour d'un rattachement : session relue, identité posée, retour sur `/profil`. */
async function completeLink(
  base: string,
  provider: OAuthProvider,
  identity: OAuthIdentity,
): Promise<NextResponse> {
  // Relue ici et pas seulement au départ : dix minutes séparent les deux, et
  // la session a pu expirer ou changer entre-temps. Rattacher sur la foi du
  // seul cookie d'état poserait une porte d'entrée sur un compte que plus rien
  // ne prouve être celui de l'appelant.
  const user = await getCurrentUser();
  if (!user) return loginFailure(base, provider, "session");

  let outcome: OAuthLinkOutcome;
  try {
    outcome = await linkOAuthIdentity(user.id, identity);
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
  // Une identité **déjà** rattachée vient d'être relue, pas ajoutée : le
  // profil le dit autrement (« rattaché » serait faux, il l'était déjà).
  if (outcome === "REFRESHED") url.searchParams.set("refreshed", "1");
  return NextResponse.redirect(url);
}

/** Retour d'une connexion : compte retrouvé ou créé, session ouverte. */
async function completeLogin(
  base: string,
  provider: OAuthProvider,
  identity: OAuthIdentity,
  saved: OAuthStatePayload,
  locale: Locale,
): Promise<NextResponse> {
  try {
    // L'acceptation voyage dans le cookie d'état, scellée à l'aller comme
    // l'intention : lue dans l'URL du rappel, elle serait choisie par
    // l'appelant.
    const userId = await createOrGetOAuthUser(identity, { termsAccepted: saved.termsAccepted });
    await createSession(userId, `LOGIN_${provider}`);
  } catch (error) {
    // Un compte neuf sans les conditions acceptées : la page de connexion le
    // dit, plutôt qu'un « échec de connexion » qui ferait réessayer pour rien.
    if ((error as Error).message === TERMS_REQUIRED) return loginFailure(base, provider, "terms", locale);
    // Compte suspendu : l'exposé de la décision voyage dans un cookie
    // `httpOnly` de courte durée, jamais dans l'URL — il porte un motif, que
    // l'historique du navigateur et les journaux des relais n'ont pas à garder.
    // Chemin `/` et non `/connexion` : la page de connexion vit aussi sous
    // `/en/connexion`, qu'un cookie borné à `/connexion` n'atteindrait pas.
    // Seul le middleware le lit, et seulement sur la page de connexion, qu'il
    // compare sans préfixe de langue (`middleware.ts`).
    if (error instanceof AccountSuspendedError) {
      const response = loginFailure(base, provider, "suspended", locale);
      response.cookies.set(SUSPENSION_NOTICE_COOKIE, encodeSuspensionNotice(error.notice), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SUSPENSION_NOTICE_COOKIE_MAX_AGE_SECONDS,
      });
      return response;
    }
    return loginFailure(base, provider, "oauth", locale);
  }

  // Refiltrée (le cookie ne fait pas foi), puis rendue dans la langue du départ.
  return NextResponse.redirect(new URL(loginDestination(saved.redirectTo || DEFAULT_REDIRECT, locale), base));
}
