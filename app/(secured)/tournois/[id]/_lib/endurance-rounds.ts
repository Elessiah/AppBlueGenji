import type { BracketMatch } from "@/lib/shared/types";

/**
 * Intitulé d'un tour de l'arbre final en mode BlueGenji Survie.
 *
 * L'en-tête annonçait « PLAY-OFFS · TOUR 1 » — un numéro qui ne dit pas où en
 * est le tournoi, là où le reste du site nomme ses stades (`bracket-sections.ts`
 * pour l'élimination). Le lecteur devait compter les rencontres pour savoir s'il
 * regardait des quarts ou une finale.
 *
 * Le stade se déduit du **nombre de rencontres décisives** du tour, et non de sa
 * position : les tours de play-off sont posés au fur et à mesure, si bien qu'un
 * comptage à rebours nommerait « finale » le seul tour existant au moment où les
 * quarts s'ouvrent. La petite finale est écartée du compte — elle ne qualifie
 * personne, et un tour d'une finale plus une petite finale en compterait deux.
 *
 * Un effectif qui n'est pas une puissance de deux (tournoi sous-rempli) donne un
 * nombre de rencontres sans nom consacré : le numéro de tour reste alors le
 * repli, plutôt qu'un stade inventé.
 *
 * Module pur : aucune dépendance au rendu.
 */
export function endurancePlayoffStage(matches: BracketMatch[], roundIndex: number): string {
  const decisive = matches.filter((match) => match.bracket !== "THIRD_PLACE").length;

  if (decisive === 1) return "FINALE";
  if (decisive === 2) return "DEMI-FINALES";
  if (decisive === 4) return "QUARTS DE FINALE";
  if (decisive === 8) return "8ÈMES DE FINALE";

  return `TOUR ${roundIndex}`;
}
