/**
 * Frontières JSX où une espace se perd.
 *
 * Le compilateur JSX retire le saut de ligne en tête d'un nœud de texte **et**
 * l'indentation qui le suit, et n'insère une espace qu'à l'intérieur d'un même
 * nœud réparti sur plusieurs lignes — jamais à la frontière d'un élément. Un
 * `</strong>` qui termine sa ligne est donc collé au mot qui ouvre la suivante.
 *
 * Moteur partagé par `rgpd-jsx-spacing.test.ts` (toutes les balises d'une page)
 * et `jsx-inline-spacing.test.ts` (balises de phrasé, sur tout le site) : deux
 * copies du motif finiraient par rendre deux verdicts sur la même source.
 */

/** N'importe quelle balise fermante en fin de ligne. */
export const ANY_CLOSING_TAG = /<\/[A-Za-z][\w.]*>\s*$/;

/**
 * Balises de **phrasé** (emphase, code…) en fin de ligne : jamais des éléments
 * flex, contrairement à un `<span>` d'icône qui vit presque toujours dans un
 * conteneur à `gap`, où l'espace n'a pas à exister.
 */
export const PHRASING_CLOSING_TAG = /<\/(strong|em|b|i|code|abbr|kbd|mark|small|sup|sub)>\s*$/;

/** Une ligne qui reprend du texte (et non une balise, une expression ou un `)`). */
const TEXT_START = /^\s*[\p{L}\p{N}«(&'"]/u;

/**
 * Numéros (base 1) des lignes qui ferment une balise en perdant l'espace avec
 * la ligne suivante.
 */
export function collapsedBoundaries(source: string, closingTag: RegExp = ANY_CLOSING_TAG): number[] {
  const lines = source.split(/\r?\n/);
  const found: number[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (closingTag.test(lines[i]) && TEXT_START.test(lines[i + 1])) found.push(i + 1);
  }
  return found;
}
