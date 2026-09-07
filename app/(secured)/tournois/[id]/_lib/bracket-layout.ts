/**
 * Hauteur d'un créneau de l'arbre à élimination.
 *
 * `BracketTree` range chaque match dans un **créneau** de hauteur fixe, et toute
 * sa géométrie en descend : la position d'un trait est `(index + 0.5) × hauteur
 * de créneau`, et deux rounds voisins ne s'alignent que parce que leurs
 * créneaux couvrent la même hauteur totale. La hauteur doit donc rester
 * **uniforme** — c'est elle qui tient les traits, pas l'inverse.
 *
 * Or la carte d'un match, elle, n'a pas de hauteur fixe : elle grandit d'une
 * rangée par action offerte au lecteur (horaire, caster, saisie du score,
 * « ✎ Éditer le score », « ⚠ Signaler un problème », « 🔒 Score verrouillé »).
 * Passé la hauteur du créneau, elle débordait par le haut et par le bas, et le
 * libellé du match suivant (« Quart de finale 2 ») venait se poser sur le bas de
 * la carte précédente.
 *
 * D'où ce module : la hauteur de créneau n'est plus une constante mais la
 * **plus haute carte réellement rendue**, mesurée dans le navigateur, avec
 * l'ancienne constante pour plancher.
 */

/**
 * Plancher de la hauteur d'un créneau.
 *
 * C'est l'ancienne constante : une carte ordinaire (deux équipes, aucune
 * action) est bien plus courte, et l'arbre garde donc exactement l'allure qu'il
 * avait avant la mesure.
 */
export const MIN_SLOT_HEIGHT = 140;

/**
 * Air laissée autour de la carte la plus haute, en pixels.
 *
 * Le contenu est centré dans son créneau : cette valeur est donc l'espace qui
 * sépare deux cartes voisines quand elles sont toutes deux à la hauteur
 * maximale — assez pour que le libellé de l'une ne touche pas l'autre.
 */
export const SLOT_BREATHING_ROOM = 20;

/**
 * Hauteur uniforme d'un créneau, d'après les hauteurs mesurées de ses contenus.
 *
 * Les valeurs nulles ou absurdes sont ignorées : une mesure vaut `0` tant que
 * l'élément n'est pas peint (rendu serveur, jsdom, onglet en arrière-plan), et
 * la retenir ferait retomber tout l'arbre sur le plancher au premier rendu.
 */
export function slotUnitHeight(
  contentHeights: Iterable<number>,
  minHeight: number = MIN_SLOT_HEIGHT,
  breathingRoom: number = SLOT_BREATHING_ROOM,
): number {
  let tallest = 0;
  for (const height of contentHeights) {
    if (!Number.isFinite(height) || height <= 0) continue;
    if (height > tallest) tallest = height;
  }
  if (tallest === 0) return minHeight;
  return Math.max(minHeight, Math.ceil(tallest) + breathingRoom);
}
