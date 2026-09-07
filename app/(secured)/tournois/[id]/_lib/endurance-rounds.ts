import type { BracketMatch } from "@/lib/shared/types";

/**
 * Découpe d'un tour de l'arbre final en mode BlueGenji Survie, pour l'affichage.
 *
 * L'en-tête annonçait « PLAY-OFFS · TOUR 1 » — un numéro qui ne dit pas où en
 * est le tournoi, là où le reste du site nomme ses stades
 * (`bracket-sections.ts` pour l'élimination). Le lecteur devait compter les
 * rencontres pour savoir s'il regardait des quarts ou une finale.
 *
 * Module pur : il ne décide que du découpage et des intitulés, le composant
 * n'a plus qu'à rendre les groupes.
 */

/** Un bloc de rencontres partageant un intitulé. */
export interface EndurancePlayoffGroup {
  /** Clé stable pour le rendu — le `bracket` des rencontres du bloc. */
  key: "UPPER" | "THIRD_PLACE";
  title: string;
  matches: BracketMatch[];
}

/**
 * Stade d'un tour, déduit du **nombre de rencontres décisives** et non de la
 * position du tour : les tours de play-off sont posés au fur et à mesure, si
 * bien qu'un comptage à rebours nommerait « finale » le seul tour existant au
 * moment où les quarts s'ouvrent.
 *
 * La petite finale est écartée du compte — elle ne qualifie personne, et un
 * tour d'une finale plus une petite finale en compterait deux.
 *
 * Un effectif qui n'est pas une puissance de deux (tournoi sous-rempli) donne
 * un nombre de rencontres sans nom consacré : le numéro de tour reste alors le
 * repli, plutôt qu'un stade inventé.
 */
export function endurancePlayoffStage(decisiveCount: number, roundIndex: number): string {
  if (decisiveCount === 1) return "FINALE";
  if (decisiveCount === 2) return "DEMI-FINALES";
  if (decisiveCount === 4) return "QUARTS DE FINALE";
  if (decisiveCount === 8) return "8ÈMES DE FINALE";

  return `TOUR ${roundIndex}`;
}

/**
 * Blocs d'un tour d'arbre final : les rencontres décisives sous leur stade,
 * **puis** la petite finale sous le sien.
 *
 * Les ranger ensemble était trompeur : la finale et la petite finale vivent
 * dans le même tour, `MatchRow` n'affiche aucun `bracket`, et un unique
 * intitulé « FINALE » coiffait donc deux rencontres indiscernables — sans dire
 * laquelle décidait du titre. Le reste du site nomme déjà celle de la 3ᵉ place
 * (`stageName`, `BracketTree`).
 *
 * Un bloc vide n'est jamais rendu : les tours qui n'ont pas de petite finale —
 * tous sauf le dernier — n'en montrent aucun en-tête.
 */
export function endurancePlayoffGroups(
  matches: BracketMatch[],
  roundIndex: number,
): EndurancePlayoffGroup[] {
  const decisive = matches.filter((match) => match.bracket !== "THIRD_PLACE");
  const thirdPlace = matches.filter((match) => match.bracket === "THIRD_PLACE");

  const groups: EndurancePlayoffGroup[] = [];
  if (decisive.length > 0) {
    groups.push({
      key: "UPPER",
      title: endurancePlayoffStage(decisive.length, roundIndex),
      matches: decisive,
    });
  }
  if (thirdPlace.length > 0) {
    groups.push({ key: "THIRD_PLACE", title: "PETITE FINALE", matches: thirdPlace });
  }

  return groups;
}
