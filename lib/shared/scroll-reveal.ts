/**
 * Défilement horizontal d'une zone jusqu'à un élément « courant » — étape de
 * la frise d'un tournoi, dernière manche d'une survie ou d'une ronde suisse.
 *
 * Une frise ou une rangée de manches plus large que l'écran s'ouvre sur son
 * début : sur mobile, l'étape où en est le tournoi, ou la manche qui se joue,
 * était hors champ à droite, et rien ne disait qu'il fallait défiler pour la
 * trouver. La zone est donc défilée **une fois**, au montage puis quand le
 * « courant » change — jamais à chaque rendu, ce qui reprendrait la main au
 * lecteur qui fait défiler lui-même.
 *
 * Module pur : le calcul se teste sans DOM, le composant ne fait que mesurer.
 */

/** Attribut qui désigne, dans une zone défilante, l'élément à rendre visible. */
export const SCROLL_REVEAL_ATTRIBUTE = "data-scroll-reveal";

export interface ScrollRevealGeometry {
  /** Défilement actuel de la zone. */
  scrollLeft: number;
  /** Largeur visible de la zone (`clientWidth`). */
  viewportWidth: number;
  /** Largeur totale du contenu (`scrollWidth`). */
  scrollWidth: number;
  /** Bord gauche de la cible, mesuré depuis l'origine du contenu. */
  targetStart: number;
  /** Bord droit de la cible, mesuré depuis l'origine du contenu. */
  targetEnd: number;
  /**
   * Marge gardée de chaque côté de la cible — celle d'un dégradé de bord, qui
   * effacerait sinon ce qu'on vient de montrer.
   */
  margin?: number;
}

/**
 * Défilement qui rend la cible entièrement visible en bougeant **le moins
 * possible** : rien si elle l'est déjà, sinon son bord qui dépasse est ramené au
 * bord de la zone. Une cible plus large que la zone montre son début — c'est là
 * que se lit son titre. Le résultat est borné au défilement possible.
 */
export function revealScrollLeft({
  scrollLeft,
  viewportWidth,
  scrollWidth,
  targetStart,
  targetEnd,
  margin = 0,
}: ScrollRevealGeometry): number {
  const maxScroll = Math.max(0, scrollWidth - viewportWidth);
  let next = scrollLeft;
  if (targetEnd + margin > next + viewportWidth) next = targetEnd + margin - viewportWidth;
  if (targetStart - margin < next) next = targetStart - margin;
  return Math.min(Math.max(next, 0), maxScroll);
}
