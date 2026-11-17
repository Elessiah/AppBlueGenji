/** Tours d'un arbre final de BlueGenji Survie (partagés par la fiche et les aperçus). */
import type { BracketMatch } from "../types";
import { playoffNextRoundPositions } from "./playoffs";

/** Ce que le compte des tours lit d'une rencontre de l'arbre. */
export type PlayoffRoundMatch = Pick<BracketMatch, "roundNumber" | "matchNumber" | "status" | "doubleForfeit">;

/** Un créneau de l'arbre : rencontre posée ou case à pourvoir (identifiant négatif). */
export type PlayoffSlotRef = { id: number; roundNumber: number; matchNumber: number };

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
  decisive: readonly Pick<BracketMatch, "roundNumber">[],
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

/**
 * Identifiant d'un créneau à pourvoir. **Négatif**, donc impossible à confondre
 * avec une rencontre : il ne sert qu'à relier les traits de l'arbre entre eux,
 * et une carte qui le porte ne s'ouvre ni ne se planifie.
 */
function ghostSlotId(roundNumber: number, matchNumber: number): number {
  return -(roundNumber * 1000 + matchNumber);
}

/**
 * Les créneaux des tours **pas encore posés**, pour que l'arbre se montre
 * entier dès l'ouverture des play-offs.
 *
 * Le moteur ne crée un tour qu'une fois le précédent complet. Dessiner les
 * seuls tours posés laissait donc l'arbre à une colonne : on lisait les quarts
 * de finale sans voir où ils menaient, alors que la forme du tableau est
 * connue d'avance — chaque tour divise l'effectif par deux, en arrondissant
 * vers le haut (le vainqueur surnuméraire passe le tour, cf.
 * `finalizePlayoffsIfDone`), exactement le compte de
 * {@link endurancePlayoffRoundCount}.
 *
 * Les créneaux rendus s'arrêtent à la finale, et la liste est **vide** tant que
 * l'arbre n'a pas commencé comme une fois la finale posée : il n'y a alors plus
 * rien à annoncer.
 *
 * **Un tournoi clos n'annonce plus rien non plus**, et ce n'est pas une
 * précaution de principe : deux demi-finales closes sur un double forfait ne
 * qualifient personne, `advancePlayoffsOneStep` clôt alors le tournoi sur le
 * classement de qualification **sans jamais poser la finale**. Le dernier tour
 * posé portant toujours deux rencontres, la prédiction `ceil(n/2)` annonçait
 * une finale `TBD` – `TBD` sous un tableau terminé, traits compris. Tant que le
 * tournoi vit, prédire un tour de trop ne coûte rien — il arrivera ; une fois
 * clos, plus rien n'arrive.
 */
export function endurancePlayoffGhostSlots(
  decisive: readonly PlayoffRoundMatch[],
  tournamentFinished = false,
): PlayoffSlotRef[] {
  if (tournamentFinished) return [];

  const rounds = [...new Set(decisive.map((match) => match.roundNumber))];
  if (rounds.length === 0) return [];

  const lastRound = Math.max(...rounds);
  const lastMatches = decisive
    .filter((match) => match.roundNumber === lastRound)
    .sort((a, b) => a.matchNumber - b.matchNumber);
  let remaining = lastMatches.length;

  const slots: PlayoffSlotRef[] = [];
  let roundNumber = lastRound;
  while (remaining > 1) {
    // Le tour qui suit le dernier posé se compte sur la règle du moteur : une
    // paire vidée par deux doubles forfaits n'y donne aucune rencontre
    // (`playoffNextRoundPositions`). Au-delà, rien n'est joué : `ceil(n/2)`.
    remaining =
      roundNumber === lastRound
        ? new Set(playoffNextRoundPositions(lastMatches).filter((position) => position !== null)).size
        : Math.ceil(remaining / 2);
    roundNumber += 1;
    for (let matchNumber = 1; matchNumber <= remaining; matchNumber += 1) {
      slots.push({ id: ghostSlotId(roundNumber, matchNumber), roundNumber, matchNumber });
    }
  }
  return slots;
}
