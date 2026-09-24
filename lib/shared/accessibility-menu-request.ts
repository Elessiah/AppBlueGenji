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

/**
 * Demande l'ouverture du menu. Sans effet si aucun menu n'écoute (page rendue
 * sans la mise en page racine) : le lien ne casse rien, il ne fait simplement rien.
 */
export function requestAccessibilityMenu(target: EventTarget = window): void {
  target.dispatchEvent(new Event(OPEN_ACCESSIBILITY_MENU_EVENT));
}
