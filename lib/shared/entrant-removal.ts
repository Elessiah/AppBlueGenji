/**
 * Retrait d'un engagé du plateau par le staff — logique pure, partagée.
 *
 * Une inscription ne se défaisait pas. Un joueur qui s'était engagé par erreur,
 * une équipe fantôme cochée une fois de trop dans un lot de trente, un engagé
 * qui prévient la veille qu'il ne viendra pas : le plateau les gardait tous
 * jusqu'au coup d'envoi, et la seule sortie — l'abandon — exige que le tournoi
 * soit **en cours**, ne vaut que pour trois formats, et laisse l'engagé au
 * classement avec un forfait à son nom. Pour un tournoi qui n'a pas commencé,
 * c'est écrire une défaite là où il n'y a jamais eu de match.
 *
 * D'où un geste distinct, réservé au staff `tournaments` (administrateur ou
 * arbitre) : l'inscription est **effacée**, l'engagé n'a jamais figuré au
 * plateau. Et une fenêtre qui tient en une phrase : **jusqu'au début du
 * tournoi**, pas une seconde de plus.
 *
 * La borne n'est pas un choix de prudence, c'est la seule qui se tienne. Au coup
 * d'envoi le tirage est fait : le plateau, les classements de départ et les
 * appariements de la première manche descendent tous de la liste des inscrites.
 * En retirer une après coup laisserait un match sans adversaire et un classement
 * qui compte une équipe absente ; c'est justement ce que l'abandon sait faire, à
 * sa place et avec ses règles. Avant le coup d'envoi, rien de tout cela n'existe
 * encore : il n'y a qu'une ligne d'inscription à effacer.
 *
 * Module pur : l'interface s'en sert pour n'afficher le bouton que lorsqu'il mène
 * quelque part — et pour dire, quand il ne mène nulle part, ce qui l'a fermé —,
 * le serveur pour rejouer la règle sous verrou.
 */
import { computeTournamentState, type TournamentStateInput } from "./tournament-state";

/**
 * Vue minimale d'un tournoi, satisfaite par `TournamentCard` comme par une ligne
 * SQL : ce sont les dates et l'état, rien d'autre.
 */
export type RemovableEntrantTournament = TournamentStateInput;

/**
 * Ce qui ferme la fenêtre de retrait.
 *
 * Les codes sont ceux que le serveur renvoie tels quels, et les phrases
 * françaises vivent ici : une seule formulation, du module pur jusqu'au toast.
 * Deux codes et non un seul, alors que la règle est unique (« le tournoi a
 * commencé ») : un tournoi terminé s'entend dire qu'il est terminé, pas qu'il
 * vient de commencer.
 */
export type EntrantRemovalBlockReason =
  | "ENTRANT_REMOVAL_TOURNAMENT_STARTED"
  | "ENTRANT_REMOVAL_TOURNAMENT_FINISHED";

/**
 * Les deux refus, rédigés.
 *
 * Chacun nomme le geste qui reste ouvert plutôt que de s'arrêter au constat :
 * qui vient retirer un engagé d'un tournoi lancé cherche l'abandon, et a besoin
 * qu'on le lui dise.
 */
export const ENTRANT_REMOVAL_BLOCK_MESSAGES: Record<EntrantRemovalBlockReason, string> = {
  ENTRANT_REMOVAL_TOURNAMENT_STARTED:
    "Le tournoi a commencé : le tirage est fait, un engagé ne s'en retire plus que par abandon.",
  ENTRANT_REMOVAL_TOURNAMENT_FINISHED:
    "Le tournoi est terminé : sa liste d'engagés est désormais son palmarès.",
};

/** Phrase française d'un refus de retrait. */
export function entrantRemovalBlockMessage(reason: EntrantRemovalBlockReason): string {
  return ENTRANT_REMOVAL_BLOCK_MESSAGES[reason];
}

/**
 * Premier obstacle au retrait d'un engagé, ou `null` s'il n'y en a pas.
 *
 * Deux lectures de l'état y concourent, et il faut les deux — même raisonnement
 * que `launchBlockReason` (`./tournament-launch.ts`), et pour cause, c'est la
 * même paire de sources : le *stocké*, qu'un lancement anticipé ou une clôture
 * à la main a pu avancer avant l'heure, et le *calculé*, qui a pu dépasser le
 * coup d'envoi sans que la colonne ait été recalée. Ne consulter que le premier
 * laisserait retirer un engagé d'un tournoi dont l'heure de début est passée,
 * pour la seule raison que personne n'a encore ouvert sa page ; ne consulter que
 * le second rouvrirait la fenêtre sur un tournoi clos avant terme.
 *
 * L'instant du coup d'envoi ferme la fenêtre, bornes comprises :
 * `computeTournamentState` rend `RUNNING` dès `now >= startAt`.
 */
export function entrantRemovalBlockReason(
  tournament: RemovableEntrantTournament,
  now: number = Date.now(),
): EntrantRemovalBlockReason | null {
  if (tournament.state === "FINISHED" || tournament.finishedAt) {
    return "ENTRANT_REMOVAL_TOURNAMENT_FINISHED";
  }
  if (tournament.state === "RUNNING") return "ENTRANT_REMOVAL_TOURNAMENT_STARTED";

  const state = computeTournamentState(tournament, now);
  if (state === "FINISHED") return "ENTRANT_REMOVAL_TOURNAMENT_FINISHED";
  if (state === "RUNNING") return "ENTRANT_REMOVAL_TOURNAMENT_STARTED";

  return null;
}

/** Raccourci de lecture : un engagé peut-il encore être retiré de ce tournoi ? */
export function canRemoveEntrant(
  tournament: RemovableEntrantTournament,
  now: number = Date.now(),
): boolean {
  return entrantRemovalBlockReason(tournament, now) === null;
}
