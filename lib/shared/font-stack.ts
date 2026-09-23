/**
 * Ce que `next/font` rend d'une police : sa pile `font-family`, sous la forme
 * `'famille'` ou `'famille', 'famille Fallback'` quand un repli à métriques
 * ajustées l'accompagne (`adjustFontFallback`, actif par défaut).
 */
export type LoadedFont = { style: { fontFamily: string } };

function families(font: LoadedFont): string[] {
  return font.style.fontFamily
    .split(",")
    .map((family) => family.trim())
    .filter(Boolean);
}

/**
 * La pile `font-family` d'une police découpée en sous-ensembles de glyphes.
 *
 * Chaque sous-ensemble est une famille à part (`next/font/local` n'accepte
 * qu'un `unicode-range` par appel) : la pile les énumère **tous d'abord**, dans
 * l'ordre donné, puis ajoute les replis. L'ordre des replis n'est pas un
 * détail — le repli ajusté du latin est calé sur Arial, qui possède les glyphes
 * latin-ext et cyrilliques : placé entre deux sous-ensembles, il servirait le
 * `Ł` de « Łukasz » avant la police qui l'a.
 *
 * Le premier sous-ensemble est celui dont le repli fait foi (le latin, le seul
 * préchargé, donc le seul dont le repli s'affiche pendant le chargement).
 */
export function fontStack(subsets: readonly LoadedFont[]): string {
  if (subsets.length === 0) throw new Error("fontStack : aucun sous-ensemble");
  const primaries = subsets.map((font) => families(font)[0]);
  const fallbacks = subsets.flatMap((font) => families(font).slice(1));
  return [...new Set([...primaries, ...fallbacks])].join(", ");
}
