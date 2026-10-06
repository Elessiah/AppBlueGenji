/**
 * Où tourne la page de connexion — et la connexion OAuth peut-elle y aboutir ?
 *
 * Google, Discord et Blizzard font sortir le joueur du site puis l'y ramènent,
 * le cookie d'état (`bg_oauth`) posé au départ devant être relu au retour. Deux
 * contextes cassent cet aller-retour, sans que le serveur puisse les
 * distinguer d'un simple lien expiré :
 *
 * - **l'app installée sur l'écran d'accueil d'iOS** — elle a ses propres
 *   cookies, et l'aller-retour s'ouvre dans une feuille Safari qui ne les
 *   partage pas. Le manifeste ne le demande pas (`display: "minimal-ui"`),
 *   mais iOS 26 coche par défaut « Ouvrir en tant qu'app web » à l'ajout, qui
 *   l'impose quel que soit le manifeste ;
 * - **le navigateur intégré d'une application** (Instagram, TikTok, une
 *   WebView Android…) — cookies isolés, et Google refuse d'y ouvrir sa page.
 *
 * Ailleurs — navigateur ordinaire, app installée par Chrome ou Android, qui
 * partagent les cookies du navigateur —, rien à signaler. Module pur : la page
 * lui passe ce qu'elle lit de `navigator` et de `matchMedia`.
 */

import { FR_LOGIN_TEXT, type LoginText } from "./login-text";

export type LoginEnvironment = "BROWSER" | "IOS_INSTALLED_APP" | "IN_APP_BROWSER";

export interface LoginEnvironmentSignals {
  userAgent: string;
  /** `navigator.standalone` — propre à iOS, `true` lancé depuis l'écran d'accueil. */
  iosStandalone?: boolean;
  /** `matchMedia("(display-mode: standalone)")` ou `fullscreen`. */
  standaloneDisplay?: boolean;
  /** `navigator.maxTouchPoints` — seul moyen de reconnaître un iPad, qui se dit Mac. */
  maxTouchPoints?: number;
}

/**
 * Jetons que les navigateurs intégrés ajoutent à leur agent utilisateur. `; wv)`
 * est la marque d'une WebView Android. Discord n'en pose aucun : son navigateur
 * intégré n'est pas reconnaissable, et le conseil ne s'affichera pas. Aucune
 * borne de mot en fin de jeton : TikTok écrit `musical_ly_2023…`, que `\b`
 * refuserait.
 */
const IN_APP_BROWSER_PATTERN =
  /\b(?:FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|BytedanceWebview|Twitter|LinkedInApp|MicroMessenger)|; wv\)/i;

function isIos({ userAgent, maxTouchPoints = 0 }: LoginEnvironmentSignals): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  // iPadOS se présente en Mac de bureau ; un Mac n'a pas d'écran tactile.
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

export function detectLoginEnvironment(signals: LoginEnvironmentSignals): LoginEnvironment {
  if (isIos(signals) && (signals.iosStandalone === true || signals.standaloneDisplay === true)) {
    return "IOS_INSTALLED_APP";
  }
  if (IN_APP_BROWSER_PATTERN.test(signals.userAgent)) return "IN_APP_BROWSER";
  return "BROWSER";
}

/**
 * Le conseil à joindre à un échec de connexion, ou `null` quand le contexte
 * n'y est pour rien. Il nomme toujours **deux** sorties : changer de navigateur,
 * ou le code Discord par message privé, qui ne quitte jamais la page. Dans la
 * langue de `text` (messages `login.environment`), le français par défaut.
 */
export function loginEnvironmentAdvice(environment: LoginEnvironment, text: LoginText = FR_LOGIN_TEXT): string | null {
  return environment === "BROWSER" ? null : text.t(`environment.advice.${environment}`);
}

/**
 * L'avertissement affiché **avant** le clic, au-dessus des boutons OAuth.
 *
 * Il ne double pas le conseil joint à l'erreur, il le rend possible pour
 * iOS : dans l'app installée, l'aller-retour s'ouvre dans une feuille Safari,
 * et c'est **elle** qui reçoit la redirection `/connexion?error=…` — une page
 * qui ne se sait plus installée (`navigator.standalone` y vaut `false`), donc
 * incapable de nommer la cause. Le seul moment où l'app sait qu'elle l'est,
 * c'est avant de partir.
 */
export function loginEnvironmentNotice(environment: LoginEnvironment, text: LoginText = FR_LOGIN_TEXT): string | null {
  return environment === "BROWSER" ? null : text.t(`environment.notice.${environment}`);
}

/** Lecture des signaux dans le navigateur. `null` côté serveur. */
export function readLoginEnvironmentSignals(): LoginEnvironmentSignals | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  const displayMatches = (mode: string) =>
    typeof window.matchMedia === "function" && window.matchMedia(`(display-mode: ${mode})`).matches;
  return {
    userAgent: navigator.userAgent,
    iosStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
    standaloneDisplay: displayMatches("standalone") || displayMatches("fullscreen"),
    maxTouchPoints: navigator.maxTouchPoints,
  };
}
