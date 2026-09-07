import { describe, expect, it } from "@jest/globals";
import {
  endurancePlayoffGroups,
  endurancePlayoffStage,
} from "@/app/(secured)/tournois/[id]/_lib/endurance-rounds";
import type { BracketMatch, BracketType } from "@/lib/shared/types";

/**
 * L'en-tête d'un tour d'arbre final annonçait « TOUR 1 » — un numéro là où le
 * reste du site nomme ses stades. Le stade se déduit du nombre de rencontres
 * **décisives** du tour, et non de sa position : les tours sont posés au fur et
 * à mesure, un comptage à rebours nommerait donc « finale » le seul tour
 * existant au moment où les quarts s'ouvrent.
 *
 * La petite finale sort du compte **et** du bloc : elle vit dans le même tour
 * que la finale, et `MatchRow` n'affiche aucun `bracket` — un intitulé unique
 * coifferait deux rencontres indiscernables.
 */

function match(bracket: BracketType = "UPPER"): BracketMatch {
  return { bracket } as BracketMatch;
}

const upper = (count: number) => Array.from({ length: count }, () => match());

describe("endurancePlayoffStage", () => {
  it("nomme les quarts, les demies et la finale", () => {
    expect(endurancePlayoffStage(4, 1)).toBe("QUARTS DE FINALE");
    expect(endurancePlayoffStage(2, 2)).toBe("DEMI-FINALES");
    expect(endurancePlayoffStage(1, 3)).toBe("FINALE");
  });

  it("nomme les 8èmes d'un plateau élargi", () => {
    expect(endurancePlayoffStage(8, 1)).toBe("8ÈMES DE FINALE");
  });

  it("retombe sur le numéro de tour hors des stades consacrés", () => {
    // Plateau qui n'est pas une puissance de deux : trois rencontres n'ont pas
    // de nom, mieux vaut le numéro qu'un stade inventé.
    expect(endurancePlayoffStage(3, 1)).toBe("TOUR 1");
    expect(endurancePlayoffStage(5, 2)).toBe("TOUR 2");
    expect(endurancePlayoffStage(0, 1)).toBe("TOUR 1");
  });
});

describe("endurancePlayoffGroups", () => {
  it("range un tour sans petite finale en un seul bloc", () => {
    const groups = endurancePlayoffGroups(upper(4), 1);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("UPPER");
    expect(groups[0].title).toBe("QUARTS DE FINALE");
    expect(groups[0].matches).toHaveLength(4);
  });

  it("sort la petite finale du bloc de la finale", () => {
    // Même tour, deux rencontres : sans ce découpage, « FINALE » coiffait les
    // deux et rien ne disait laquelle décidait du titre.
    const final = match();
    const thirdPlace = match("THIRD_PLACE");
    const groups = endurancePlayoffGroups([final, thirdPlace], 3);

    expect(groups.map((group) => [group.key, group.title])).toEqual([
      ["UPPER", "FINALE"],
      ["THIRD_PLACE", "PETITE FINALE"],
    ]);
    expect(groups[0].matches).toEqual([final]);
    expect(groups[1].matches).toEqual([thirdPlace]);
  });

  it("ne compte pas la petite finale dans le stade des décisives", () => {
    // Deux demies plus la petite finale : trois rencontres, mais le stade reste
    // celui des deux décisives.
    const groups = endurancePlayoffGroups([...upper(2), match("THIRD_PLACE")], 2);

    expect(groups[0].title).toBe("DEMI-FINALES");
  });

  it("ne rend aucun bloc vide", () => {
    expect(endurancePlayoffGroups([], 1)).toEqual([]);
    expect(endurancePlayoffGroups([match("THIRD_PLACE")], 3).map((g) => g.key)).toEqual([
      "THIRD_PLACE",
    ]);
  });
});
