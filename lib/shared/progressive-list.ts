/**
 * Affichage progressif d'une longue liste (annuaires `/joueurs` et `/equipes`).
 *
 * Les annuaires rendaient **toutes** leurs cartes d'un coup — 353 sur le jeu
 * de test —, et chaque frappe dans la recherche refiltrait puis re-rendait la
 * grille entière. La liste reste chargée en entier (les filtres et les
 * compteurs lisent tout), seul le **rendu** est borné : une première page, puis
 * une page de plus à chaque « Voir plus ».
 */

/** Cartes rendues d'emblée, puis à chaque « Voir plus ». Multiple de 2, 3 et 4 :
 * la dernière rangée reste pleine quel que soit le nombre de colonnes. */
export const DIRECTORY_PAGE_SIZE = 48;

/** Nombre de cartes rendues après un « Voir plus ». */
export function nextVisibleCount(
  current: number,
  total: number,
  step: number = DIRECTORY_PAGE_SIZE,
): number {
  return Math.max(0, Math.min(total, current + step));
}

/** Nombre d'éléments encore masqués quand `visible` sont rendus. */
export function hiddenCount(visible: number, total: number): number {
  return Math.max(0, total - Math.max(0, visible));
}
