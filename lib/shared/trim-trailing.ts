/**
 * Retire les `/` de fin d'une chaîne, en temps linéaire.
 *
 * `value.replace(/\/+$/, "")` est quadratique sur une longue suite de barres
 * suivie d'un autre caractère (chaque position de départ rebalaye la suite) :
 * sur un chemin choisi par l'appelant, c'est un déni de service à bas prix.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.codePointAt(end - 1) === 0x2f) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}
