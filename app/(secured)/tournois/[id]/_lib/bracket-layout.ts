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

/** Ce qu'un round demande : combien de matchs, et la plus haute de leurs cartes. */
export interface RoundMeasure {
  /** Nombre de matchs rendus dans ce round. */
  matchCount: number;
  /** Hauteur du plus haut contenu de créneau du round (libellé compris). */
  tallestContent: number;
}

/**
 * Hauteur unitaire d'un créneau, d'après ce que demande chaque round.
 *
 * Un round de `n` matchs ne reçoit pas la hauteur unitaire mais `hauteur totale
 * / n`, la hauteur totale valant `plus grand effectif × unité` — c'est ainsi que
 * les rounds s'alignent. Chaque round est donc large de son côté : la contrainte
 * n'est pas « l'unité tient la plus haute carte du tableau » mais « le créneau
 * *de ce round* tient la plus haute carte *de ce round* ».
 *
 * La différence n'est pas théorique. Un tableau à 128 équipes dont seule la
 * finale est datée et castée verrait, sur la règle naïve, ses **soixante-quatre**
 * créneaux de premier tour grandir de la hauteur qu'une seule carte réclame, à
 * un endroit où le créneau fait déjà seize fois la taille demandée.
 *
 * Les valeurs nulles ou absurdes sont ignorées : une mesure vaut `0` tant que
 * l'élément n'est pas peint (rendu serveur, jsdom), et la retenir ferait
 * retomber tout l'arbre sur le plancher au premier rendu.
 */
export function slotUnitHeight(
  rounds: Iterable<RoundMeasure>,
  minHeight: number = MIN_SLOT_HEIGHT,
  breathingRoom: number = SLOT_BREATHING_ROOM,
): number {
  const demands: Array<{ matchCount: number; needed: number }> = [];
  let widestRound = 0;

  for (const round of rounds) {
    if (!Number.isFinite(round.matchCount) || round.matchCount <= 0) continue;
    if (round.matchCount > widestRound) widestRound = round.matchCount;
    if (!Number.isFinite(round.tallestContent) || round.tallestContent <= 0) continue;
    demands.push({
      matchCount: round.matchCount,
      needed: Math.ceil(round.tallestContent) + breathingRoom,
    });
  }

  if (widestRound === 0) return minHeight;

  let unit = minHeight;
  for (const { matchCount, needed } of demands) {
    // `unité × plus grand effectif / effectif du round` doit couvrir `needed`.
    unit = Math.max(unit, Math.ceil((needed * matchCount) / widestRound));
  }
  return unit;
}
