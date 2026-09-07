import { describe, expect, it } from "@jest/globals";
import { endurancePlayoffStage } from "@/app/(secured)/tournois/[id]/_lib/endurance-rounds";
import type { BracketMatch, BracketType } from "@/lib/shared/types";

/**
 * L'en-tête d'un tour d'arbre final annonçait « TOUR 1 » — un numéro là où le
 * reste du site nomme ses stades. Le stade se déduit du nombre de rencontres
 * **décisives** du tour, et non de sa position : les tours sont posés au fur et
 * à mesure, un comptage à rebours nommerait donc « finale » le seul tour
 * existant au moment où les quarts s'ouvrent.
 */

function match(bracket: BracketType = "UPPER"): BracketMatch {
  return { bracket } as BracketMatch;
}

const upper = (count: number) => Array.from({ length: count }, () => match());

describe("endurancePlayoffStage", () => {
  it("nomme les quarts, les demies et la finale", () => {
    expect(endurancePlayoffStage(upper(4), 1)).toBe("QUARTS DE FINALE");
    expect(endurancePlayoffStage(upper(2), 2)).toBe("DEMI-FINALES");
    expect(endurancePlayoffStage(upper(1), 3)).toBe("FINALE");
  });

  it("nomme les 8èmes d'un plateau élargi", () => {
    expect(endurancePlayoffStage(upper(8), 1)).toBe("8ÈMES DE FINALE");
  });

  it("ne compte pas la petite finale, qui ne qualifie personne", () => {
    // Finale + petite finale : deux rencontres, un seul stade — sans ce filtre,
    // le tour du titre s'annonçait « demi-finales ».
    expect(endurancePlayoffStage([match(), match("THIRD_PLACE")], 3)).toBe("FINALE");
  });

  it("retombe sur le numéro de tour hors des stades consacrés", () => {
    // Plateau qui n'est pas une puissance de deux : trois rencontres n'ont pas
    // de nom, mieux vaut le numéro qu'un stade inventé.
    expect(endurancePlayoffStage(upper(3), 1)).toBe("TOUR 1");
    expect(endurancePlayoffStage(upper(5), 2)).toBe("TOUR 2");
  });

  it("retombe sur le numéro de tour sur un tour vide", () => {
    expect(endurancePlayoffStage([], 1)).toBe("TOUR 1");
  });
});
