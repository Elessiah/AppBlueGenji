/** Nombre de tours d'un arbre final de BlueGenji Survie (partagé par la fiche et les aperçus). */
import type { BracketMatch } from "../types";

/**
 * Nombre de tours que l'arbre final comptera **une fois complet**.
 *
 * Le moteur ne pose que le premier tour à l'ouverture des play-offs, puis un
 * tour à la fois. Nommer les stades sur les tours *posés* appelait donc les
 * quarts de finale « Finale » tant qu'ils étaient seuls, puis « Demi-finales »
 * une fois les demies créées : le tableau ne disait juste qu'au dernier tour.
 *
 * Le compte se déduit du **premier tour** : chaque tour divise l'effectif par
 * deux, en arrondissant vers le haut (un vainqueur surnuméraire passe le tour
 * au lieu d'être oublié, cf. `finalizePlayoffsIfDone`). On itère plutôt que de
 * passer par `Math.log2`, dont l'arrondi flottant ferait basculer les puissances
 * de deux d'un tour.
 *
 * `0` quand l'arbre n'a pas commencé — il n'y a alors rien à nommer.
 */
export function endurancePlayoffRoundCount(
  decisive: BracketMatch[],
  ghostSlots?: readonly Readonly<{ roundNumber: number }>[],
): number {
  const rounds = [...new Set(decisive.map((match) => match.roundNumber))];
  if (rounds.length === 0) return 0;

  // Les tours à venir sont connus (`endurancePlayoffGhostSlots`) et suivent la
  // règle du moteur : une paire vidée par deux doubles forfaits n'y donne aucune
  // rencontre, et le match qui reste *est* la finale. Compter sur la taille du
  // premier tour l'appellerait encore « Demi-finale ».
  if (ghostSlots) {
    return new Set([...rounds, ...ghostSlots.map((slot) => slot.roundNumber)]).size;
  }

  const firstRound = Math.min(...rounds);
  const lastRound = Math.max(...rounds);
  // Un dernier tour d'un seul match est la finale, quel que soit le premier tour.
  if (decisive.filter((match) => match.roundNumber === lastRound).length === 1) return rounds.length;
  let remaining = decisive.filter((match) => match.roundNumber === firstRound).length;

  let count = 1;
  while (remaining > 1) {
    remaining = Math.ceil(remaining / 2);
    count += 1;
  }
  // Un tour de plus que prévu ne se discute pas : il est là.
  return Math.max(count, rounds.length);
}
