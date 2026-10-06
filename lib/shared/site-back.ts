/**
 * « Retour » sans quitter le site.
 *
 * Un bouton qui appelle `router.back()` sans condition ramène **là d'où l'on
 * vient** — ce qui n'est le site que si l'on y naviguait déjà. Arrivé par un lien
 * partagé sur Discord ou par le lien profond d'un match, le même bouton faisait
 * quitter le site, ou revenir sur un onglet vide. Le retour dans l'historique
 * n'est donc pris que lorsque la page précédente est **connue et à nous** ; sinon
 * le bouton mène à une destination fixe, un vrai lien.
 *
 * Deux sources pour « la page précédente », dans cet ordre :
 * - la **navigation interne** relevée depuis le chargement du document
 *   (`recordSitePathname`, appelé à chaque changement de chemin par un composant
 *   de la mise en page racine) — l'App Router ne recharge pas le document, si
 *   bien que `document.referrer` reste celui de l'arrivée sur le site ;
 * - à défaut, le **référent** du document s'il est de la même origine (arrivée
 *   par un lien du site dans un nouvel onglet, ou rechargement de la page).
 */

import { splitLocalePrefix } from "./locales";

/** Pages d'où l'on ne revient pas : y retourner rejouerait la connexion. */
const NOT_A_RETURN_TARGET = ["/connexion"];

let currentPath: string | null = null;
let previousPath: string | null = null;

/**
 * Relève le chemin courant. Un chemin identique au précédent (rendu de nouveau,
 * changement de fragment) ne compte pas comme une navigation.
 */
export function recordSitePathname(pathname: string): void {
  if (pathname === currentPath) return;
  previousPath = currentPath;
  currentPath = pathname;
}

/** Chemin de la page précédente dans ce document, `null` à l'arrivée sur le site. */
export function previousSitePathname(): string | null {
  return previousPath;
}

/** Réservé aux tests : oublie la navigation relevée. */
export function resetSiteNavigation(): void {
  currentPath = null;
  previousPath = null;
}

/**
 * Chemin désigné par un référent **de notre origine**, `null` sinon (autre
 * site, référent vide ou illisible).
 */
export function sitePathFromReferrer(referrer: string, origin: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return url.origin === origin ? url.pathname : null;
  } catch {
    return null;
  }
}

export interface SiteBackInput {
  /** Chemin précédent relevé par la navigation interne. */
  previousPath: string | null;
  /** `document.referrer`. */
  referrer: string;
  /** `window.location.origin`. */
  origin: string;
  /** `window.location.pathname` — la page qu'on quitterait. */
  currentPath: string;
  /** `window.history.length` : sans entrée précédente, il n'y a rien où revenir. */
  historyLength: number;
}

/**
 * Le retour dans l'historique mène-t-il à une page du site ?
 *
 * Faux dès qu'un doute subsiste : se tromper dans ce sens fait suivre un lien
 * vers la liste, se tromper dans l'autre fait quitter le site.
 */
export function canReturnInSite(input: SiteBackInput): boolean {
  if (input.historyLength < 2) return false;
  const target = input.previousPath ?? sitePathFromReferrer(input.referrer, input.origin);
  if (target === null || target === input.currentPath) return false;
  // Comparé sans préfixe de langue : `/en/connexion` est la même page (lot 6).
  const { path } = splitLocalePrefix(target);
  return !NOT_A_RETURN_TARGET.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Clic « ordinaire » : bouton principal, sans touche de modification. Les autres
 * (nouvel onglet, nouvelle fenêtre, téléchargement) sont laissés au lien.
 */
export function isPlainLeftClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
