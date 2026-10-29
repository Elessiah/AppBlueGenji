/**
 * Le cookie qui traverse un aller-retour OAuth.
 *
 * Il porte six choses, et chacune est là pour une raison distincte :
 *
 * - **`state`** — le jeton anti-CSRF. Le rappel n'est accepté que si le `state`
 *   de l'URL est celui du cookie : sans lui, n'importe qui pourrait faire
 *   aboutir *son* code d'autorisation dans *votre* navigateur ;
 * - **`provider`** — sans lui, un état émis pour Google serait recevable sur le
 *   rappel de Blizzard. Le cookie est unique pour les trois portes (on n'en
 *   ouvre qu'une à la fois), donc c'est la seule chose qui empêche de les
 *   confondre ;
 * - **`intent`** — `LOGIN` ouvre une session, `LINK` rattache au compte déjà
 *   connecté. Un `intent` qui se lirait dans l'URL du rappel serait choisi par
 *   l'appelant : ici il est **scellé à l'aller**, décidé par la route de départ,
 *   qui a vérifié la session ;
 * - **`redirectTo`** — la destination d'après connexion, déjà filtrée à l'aller
 *   par `safeRedirectPath` et **refiltrée au retour** : ce cookie n'est pas
 *   signé, il ne fait pas foi (voir `lib/shared/safe-redirect.ts`) ;
 * - **`termsAccepted`**, **`termsAcceptedNow`**, **`localeFromPage`** — décidés à l'aller, comme
 *   l'intention : lus dans l'URL du rappel, ils seraient choisis par l'appelant.
 *
 * Un seul cookie, `bg_oauth` (`__Host-bg_oauth` en production), qui remplace l'ancien `bg_google_oauth` : trois
 * cookies auraient laissé traîner deux états périmés à chaque connexion, et
 * rien n'a de sens à mener deux allers-retours de front.
 */
import { cookies } from "next/headers";
import { isProductionCookieEnv, oauthCookieName } from "@/lib/shared/auth-cookies";
import type { OAuthIntent, OAuthProvider } from "@/lib/shared/oauth-providers";
import { isOAuthProvider } from "@/lib/shared/oauth-providers";
import { TERMS_VERSION } from "@/lib/shared/terms-of-use";

/** Dix minutes : le temps de l'écran de consentement, pas une seconde de plus. */
const OAUTH_TTL_SECONDS = 10 * 60;

export type OAuthStatePayload = {
  provider: OAuthProvider;
  state: string;
  redirectTo: string;
  intent: OAuthIntent;
  /** Conditions d'utilisation acceptées à l'aller (case de `/connexion`). */
  termsAccepted: boolean;
  /** Acceptées **dans la page** de départ, pas relues du navigateur (voir `OAuthTermsConsent`). */
  termsAcceptedNow: boolean;
  /**
   * Départ prouvé cliqué **sur une page du site** (`startedOnSitePage`,
   * navigation de document `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode:
   * navigate`, `Sec-Fetch-Dest: document`) : seule cette langue-là devient celle du compte au retour (lot
   * 9-3). Un lien posé ailleurs — autre site, favori, adresse tapée — ou un
   * départ sans preuve connecte sans toucher à la langue choisie dans « Mon
   * profil ».
   */
  localeFromPage: boolean;
};

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // `__Host-` exige `Secure` : les deux vont ensemble (`auth-cookies.ts`).
    secure: isProductionCookieEnv(),
    path: "/",
  };
}

export async function saveOAuthState(payload: OAuthStatePayload): Promise<void> {
  const cookieStore = await cookies();
  // La version acceptée voyage avec l'acceptation : un aller-retour parti avant
  // une nouvelle version (mise en ligne pendant les dix minutes chez le
  // fournisseur) ne vaut pas acceptation de celle-ci au retour.
  const sealed = payload.termsAccepted ? { ...payload, termsVersion: TERMS_VERSION } : payload;
  const encoded = Buffer.from(JSON.stringify(sealed)).toString("base64url");
  cookieStore.set(oauthCookieName(), encoded, {
    ...baseCookieOptions(),
    maxAge: OAUTH_TTL_SECONDS,
  });
}

/**
 * Relit l'état **et l'efface**, qu'il soit exploitable ou non.
 *
 * L'effacement est inconditionnel : un état qui ne correspond pas au rappel
 * reçu est un état qui a échoué, et le laisser en place le rendrait rejouable
 * pendant dix minutes.
 */
export async function consumeOAuthState(): Promise<OAuthStatePayload | null> {
  const cookieStore = await cookies();
  const encoded = cookieStore.get(oauthCookieName())?.value;
  cookieStore.set(oauthCookieName(), "", { ...baseCookieOptions(), maxAge: 0 });

  if (!encoded) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<OAuthStatePayload> & {
      termsVersion?: unknown;
    };
    if (!isOAuthProvider(parsed.provider)) return null;
    if (typeof parsed.state !== "string" || parsed.state.length === 0) return null;
    if (typeof parsed.redirectTo !== "string" || parsed.redirectTo.length === 0) return null;
    const intent: OAuthIntent = parsed.intent === "LINK" ? "LINK" : "LOGIN";
    // Acceptation scellée à une autre version (aller parti avant la mise en
    // ligne d'une nouvelle) : rien n'est accepté.
    const termsAccepted = parsed.termsAccepted === true && parsed.termsVersion === TERMS_VERSION;
    return {
      provider: parsed.provider,
      state: parsed.state,
      redirectTo: parsed.redirectTo,
      intent,
      termsAccepted,
      termsAcceptedNow: termsAccepted && parsed.termsAcceptedNow === true,
      localeFromPage: parsed.localeFromPage === true,
    };
  } catch {
    return null;
  }
}
