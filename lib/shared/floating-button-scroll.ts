/**
 * Boutons flottants estompés pendant un défilement.
 *
 * Un bouton en `position: fixed` recouvre, à l'instant où un défilement
 * s'arrête, ce qui se trouve alors dans son coin — en mobile, le début des
 * lignes de texte, la gouttière n'étant que de 16 px. Aucune marge ne l'évite :
 * un défilement tactile s'arrête à n'importe quel pixel. Et en match, quatre
 * flottants se partagent le bas de l'écran (accessibilité, « ? » des règles,
 * « Mon match », témoin du régime de charge) : ensemble, ils masquaient une
 * bande d'environ 120 px.
 *
 * Un seul écouteur pour tous (`FloatingScrollWatcher`, en mise en page racine)
 * pose `data-page-scrolling` sur `<html>` le temps du geste, puis le retire une
 * fois la page immobile depuis `FLOATING_BUTTON_SETTLE_MS`. Chaque bouton décide
 * dans **sa feuille** de s'estomper, en mobile seulement — et c'est là que vit
 * l'exception, qui est la règle : on n'estompe jamais un bouton **que quelqu'un
 * est en train d'utiliser** (focus dessus ou dans son panneau, panneau ouvert :
 * `:focus-within`, `[aria-expanded="true"]`). Flèches et Espace font défiler la
 * page sans que le focus bouge.
 */

/** Délai d'immobilité après lequel les boutons réapparaissent. */
export const FLOATING_BUTTON_SETTLE_MS = 400;

/**
 * Une modale ouverte. Les boutons flottants s'y rangent (feuilles : même
 * sélecteur dans `:has()`), et le menu d'accessibilité, offert au-dessus
 * d'elles, y prend Échap quand le focus est resté dans la modale.
 */
export const OPEN_MODAL_SELECTOR = '[aria-modal="true"]';

/** Attribut posé sur `<html>` pendant un défilement de la page. */
export const PAGE_SCROLLING_ATTRIBUTE = "data-page-scrolling";
