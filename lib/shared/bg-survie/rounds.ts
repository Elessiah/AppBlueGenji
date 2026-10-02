/**
 * BlueGenji Survie — frontière entre les deux phases du mode, et format de
 * match applicable à chaque manche (`docs/features/BG_SURVIE_MODE.md`).
 *
 * Module pur : aucune dépendance base de données.
 */

import { withoutDraws, type MatchFormat } from "../match-format";

/**
 * Première manche de la phase éliminatoire.
 *
 * Les manches de qualification occupent 1..N ; les play-offs repartent d'un
 * palier élevé pour que les deux phases restent lisibles côte à côte dans
 * l'historique des matchs. Le nombre était recopié à trois endroits — le
 * moteur, la vue, et désormais la résolution du format de match : c'est une
 * frontière entre deux phases, pas un détail d'implémentation de l'une d'elles.
 */
export const PLAYOFF_ROUND_OFFSET = 1000;

/** Cette manche appartient-elle à l'arbre final ? */
export function isEndurancePlayoffRound(round: number): boolean {
  return round >= PLAYOFF_ROUND_OFFSET;
}

/**
 * Format de match applicable à une manche donnée.
 *
 * Le mode est le seul du projet à jouer **deux formats** : la phase
 * qualificative peut clore un match sans vainqueur (une map nulle arrête un BO5
 * sur 2-2, et le capital s'en accommode — il se compte map par map), l'arbre
 * final ne le peut pas — il lui faut savoir qui joue le tour suivant.
 *
 * Sans format de play-offs propre, l'arbre rejoue celui du tournoi **égalités
 * fermées** : c'est le repli le moins surprenant, et le seul qui ne laisse pas
 * un demi-finaliste indéterminé.
 */
export function enduranceMatchFormat(
  qualification: MatchFormat | null,
  playoff: MatchFormat | null,
  round: number,
): MatchFormat | null {
  if (!isEndurancePlayoffRound(round)) return qualification;
  return playoff ?? withoutDraws(qualification);
}

/**
 * **La** règle du format d'un match, tous modes confondus.
 *
 * Un seul mode joue deux formats — voir {@link enduranceMatchFormat} — et
 * partout ailleurs les égalités sont fermées de force : la validation les
 * refuse déjà à la création, mais une ligne écrite avant cette règle (ou à la
 * main en base) ne doit pas rendre un tableau à élimination directe indécidable.
 *
 * Écrite ici plutôt que deux fois : le serveur la relit à chaque saisie
 * (`loadTournamentMatchFormat`), l'interface s'en sert pour borner les champs et
 * activer « Valider le résultat ». Deux copies auraient divergé au premier
 * réglage, et la divergence se serait vue en 400 sur un formulaire qui
 * s'annonçait valide.
 *
 * `round` omis (`null`) rend le format de la **qualification** : c'est ce que
 * demandent les appelants qui ne visent pas un match précis.
 */
export function tournamentMatchFormat(
  tournamentFormat: string,
  qualification: MatchFormat | null,
  playoff: MatchFormat | null,
  round?: number | null,
): MatchFormat | null {
  if (tournamentFormat !== "BG_SURVIE") return withoutDraws(qualification);
  if (round === null || round === undefined) return qualification;

  return enduranceMatchFormat(qualification, playoff, round);
}
