/**
 * Ouverture du menu d'accessibilité depuis ailleurs que son bouton flottant.
 *
 * Le bouton, en bas à gauche, se manque : un visiteur qui cherche « accessibilité »
 * regarde d'abord le pied de page, comme sur la plupart des sites. Le lien qu'on y
 * pose n'ouvre pas une seconde copie du menu — deux copies auraient deux états —,
 * il **demande** au menu unique, monté par la mise en page racine, de s'ouvrir.
 *
 * Un évènement du document plutôt qu'un contexte React : le pied de page est un
 * composant serveur, rendu hors de l'arbre client du menu, et n'a pas d'ancêtre
 * commun avec lui où poser un fournisseur.
 */

export const OPEN_ACCESSIBILITY_MENU_EVENT = "bg:open-accessibility-menu";

/** Charge utile de la demande : l'élément à qui rendre le focus à la fermeture. */
export interface AccessibilityMenuRequest {
  opener: HTMLElement | null;
}

/**
 * Demande l'ouverture du menu. Sans effet si aucun menu n'écoute (page rendue
 * sans la mise en page racine) : le lien ne casse rien, il ne fait simplement rien.
 *
 * `opener` est transmis explicitement plutôt que déduit de `document.activeElement` :
 * Safari ne donne pas le focus à un bouton cliqué, si bien que l'élément actif
 * serait `<body>` et le focus reviendrait au bouton flottant, à l'autre bout de
 * la page.
 */
export function requestAccessibilityMenu(
  opener: HTMLElement | null = null,
  target: EventTarget = window,
): void {
  target.dispatchEvent(
    new CustomEvent<AccessibilityMenuRequest>(OPEN_ACCESSIBILITY_MENU_EVENT, { detail: { opener } }),
  );
}

/**
 * Élément à qui rendre le focus quand le menu se ferme : le déclencheur nommé
 * par la demande, à défaut l'élément actif — jamais `<body>` ni un élément du
 * menu lui-même (le bouton flottant est alors le repli). `null` = bouton flottant.
 */
export function resolveMenuOpener<T>(
  requested: T | null | undefined,
  active: T | null,
  body: T | null,
  insideMenu: (element: T) => boolean,
): T | null {
  const candidate = requested ?? active;
  if (candidate == null || candidate === body || insideMenu(candidate)) return null;
  return candidate;
}

/** Cible du focus à la fermeture : le déclencheur s'il est encore dans la page, sinon le repli. */
export function focusReturnTarget<T extends { isConnected: boolean }>(opener: T | null, fallback: T | null): T | null {
  return opener?.isConnected ? opener : fallback;
}
