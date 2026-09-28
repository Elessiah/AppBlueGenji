/**
 * Bouton flottant estompé pendant un défilement.
 *
 * Un bouton en `position: fixed` recouvre, à l'instant où un défilement
 * s'arrête, ce qui se trouve alors dans son coin — en mobile, le début des
 * lignes de texte, la gouttière n'étant que de 16 px. Aucune marge ne l'évite :
 * un défilement tactile s'arrête à n'importe quel pixel. Le bouton s'efface
 * donc le temps du geste, puis revient une fois la page immobile depuis
 * `FLOATING_BUTTON_SETTLE_MS`.
 *
 * Deux exceptions, et c'est la règle : on n'estompe jamais un bouton **que
 * quelqu'un est en train d'utiliser** — menu ouvert, ou focus clavier dans le
 * menu (flèches et Espace font défiler la page sans que le focus bouge).
 */

/** Délai d'immobilité après lequel le bouton réapparaît. */
export const FLOATING_BUTTON_SETTLE_MS = 400;

export interface FloatingButtonScrollState {
  /** Le panneau du menu est ouvert. */
  menuOpen: boolean;
  /** Le focus est sur le bouton ou dans le panneau. */
  focusWithin: boolean;
}

/** Le bouton doit-il s'estomper au défilement qui vient d'être observé ? */
export function shouldFadeFloatingButton({ menuOpen, focusWithin }: FloatingButtonScrollState): boolean {
  return !menuOpen && !focusWithin;
}
