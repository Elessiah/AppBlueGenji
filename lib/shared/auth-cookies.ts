/**
 * Noms des cookies d'authentification — session et état OAuth
 * (`docs/features/AUTH_SYSTEM.md` § Cookies `__Host-`).
 *
 * En production, ils portent le préfixe `__Host-` : le navigateur ne les
 * accepte alors que posés en `Secure`, sur `Path=/` et **sans** `Domain`, par
 * le site lui-même. Un sous-domaine voisin (même nginx) ne peut donc plus en
 * poser un pour le domaine parent — ni fixer une session, ni forger un état
 * OAuth (`termsAccepted`, `localeFromPage`).
 *
 * Hors production, le nom reste nu : `Secure` n'y est pas posé (le serveur de
 * développement parle `http://127.0.0.1`), et un cookie `__Host-` sans
 * `Secure` serait refusé par le navigateur — plus aucune connexion locale.
 *
 * Le préfixe déconnecte tout le monde une fois, au déploiement : le cookie nu
 * n'est plus lu en production, et le middleware l'efface
 * ({@link legacyAuthCookieNames}) pour qu'il ne traîne pas trente jours.
 */

/** Nom nu du cookie de session (développement, tests, e2e). */
export const SESSION_COOKIE_BASE = "bg_session";
/** Nom nu du cookie d'état d'un aller-retour OAuth. */
export const OAUTH_COOKIE_BASE = "bg_oauth";
export const HOST_COOKIE_PREFIX = "__Host-";

/** Lu à chaque appel, pas figé au chargement du module (les tests le font varier). */
export function isProductionCookieEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/** `__Host-<nom>` en production, le nom nu ailleurs. */
export function hostCookieName(base: string, production = isProductionCookieEnv()): string {
  return production ? `${HOST_COOKIE_PREFIX}${base}` : base;
}

export function sessionCookieName(production = isProductionCookieEnv()): string {
  return hostCookieName(SESSION_COOKIE_BASE, production);
}

export function oauthCookieName(production = isProductionCookieEnv()): string {
  return hostCookieName(OAUTH_COOKIE_BASE, production);
}

/**
 * Cookies d'avant le préfixe, que le middleware efface en production. Vide
 * ailleurs : le nom nu y est le cookie **en service**.
 */
export function legacyAuthCookieNames(production = isProductionCookieEnv()): string[] {
  return production ? [SESSION_COOKIE_BASE, OAUTH_COOKIE_BASE] : [];
}
