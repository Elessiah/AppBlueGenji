import { SCROLL_OVERFLOW_TOLERANCE_PX } from "./scroll-overflow";

/**
 * Indice de défilement horizontal d'une `ScrollArea` au tactile.
 *
 * La variante discrète (`subtle`) ne révèle sa barre qu'au survol, et les
 * navigateurs mobiles superposent de toute façon une barre qui s'efface : sur
 * téléphone, un arbre, une frise ou un classement plus large que l'écran ne
 * montrait qu'un contenu coupé net, sans rien qui dise qu'il continue. La zone
 * porte donc `data-scroll-hint`, que `app/globals.css` traduit, sous
 * `(pointer: coarse)` seulement, en un dégradé sur le **bord où il reste du
 * contenu** — jamais sur un bord déjà atteint, où il effacerait pour rien le
 * premier ou le dernier élément.
 *
 * Rend les jetons `start` / `end` séparés d'une espace (lus par `~=`), ou
 * `null` quand rien ne dépasse.
 */
export function horizontalScrollHint(metrics: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): string | null {
  const hidden = metrics.scrollWidth - metrics.clientWidth;
  if (hidden <= SCROLL_OVERFLOW_TOLERANCE_PX) return null;
  const tokens: string[] = [];
  if (metrics.scrollLeft > SCROLL_OVERFLOW_TOLERANCE_PX) tokens.push("start");
  if (hidden - metrics.scrollLeft > SCROLL_OVERFLOW_TOLERANCE_PX) tokens.push("end");
  return tokens.length > 0 ? tokens.join(" ") : null;
}
