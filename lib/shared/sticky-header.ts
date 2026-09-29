/**
 * Hauteur de l'en-tête collant, source des marges d'ancre (WCAG 2.4.11).
 *
 * Les en-têtes du site (`PublicHeader` de la vitrine, `ArenaNav` de l'espace
 * connecté) sont `position: sticky; top: 0`, et leur hauteur **varie** : selon
 * l'en-tête, la largeur d'écran et le retour à la ligne des actions, on a
 * mesuré 110, 124 et 134 px. Une marge écrite en dur (`scroll-margin-top:
 * 96px`, recopiée dans huit feuilles) rangeait donc la cible d'une ancre sous
 * l'en-tête. La hauteur est désormais **mesurée** (`StickyHeaderOffset`) et
 * posée sur `<html>` ; une seule règle, `html { scroll-padding-top }`, s'en
 * sert pour toute ancre, tout `scrollIntoView` et tout défilement de focus.
 */

/** Attribut posé sur l'en-tête collant de la page — il n'y en a qu'un. */
export const STICKY_HEADER_ATTR = "data-sticky-header";

/** Propriété CSS portée par `<html>` : hauteur mesurée de l'en-tête collant. */
export const STICKY_HEADER_HEIGHT_VAR = "--sticky-header-h";

/**
 * Valeur de la propriété pour une hauteur mesurée : arrondie au pixel
 * supérieur (une fraction de pixel suffit à rogner le haut d'un titre), `0px`
 * sans en-tête ou pour une mesure illisible.
 */
export function stickyHeaderHeightValue(height: number | null | undefined): string {
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return "0px";
  return `${Math.ceil(height)}px`;
}
