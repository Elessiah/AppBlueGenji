import { describe, expect, it } from "@jest/globals";
import {
  LOWER_FINAL_WINNER_PLACEHOLDER,
  UPPER_FINAL_WINNER_PLACEHOLDER,
  localizeBracketPlaceholder,
  lowerWinnerPlaceholder,
  upperLoserPlaceholder,
} from "@/lib/shared/bracket-placeholders";

describe("libellés d'attente de la double élimination", () => {
  it("sont en français, sans « upper » ni « lower »", () => {
    const labels = [
      UPPER_FINAL_WINNER_PLACEHOLDER,
      LOWER_FINAL_WINNER_PLACEHOLDER,
      upperLoserPlaceholder(2, 3),
      lowerWinnerPlaceholder(4, 1),
    ];
    for (const label of labels) expect(label).not.toMatch(/upper|lower|bracket|\bR\d/i);
    expect(upperLoserPlaceholder(2, 3)).toBe("Perdant match 3 du tableau principal, manche 2");
    expect(lowerWinnerPlaceholder(4, 1)).toBe("Gagnant match 1 du tableau perdants, manche 4");
  });
});

describe("localizeBracketPlaceholder", () => {
  it("traduit les libellés anglais déjà écrits en base", () => {
    expect(localizeBracketPlaceholder("Gagnant du upper bracket")).toBe(UPPER_FINAL_WINNER_PLACEHOLDER);
    expect(localizeBracketPlaceholder("Gagnant du lower bracket")).toBe(LOWER_FINAL_WINNER_PLACEHOLDER);
    expect(localizeBracketPlaceholder("Perdant match 3 du upper R2")).toBe(upperLoserPlaceholder(2, 3));
    expect(localizeBracketPlaceholder("Gagnant match 12 du lower R5")).toBe(lowerWinnerPlaceholder(5, 12));
  });

  it("rend tel quel tout autre texte", () => {
    expect(localizeBracketPlaceholder("Perdant demi-finale 1")).toBe("Perdant demi-finale 1");
    expect(localizeBracketPlaceholder(upperLoserPlaceholder(1, 1))).toBe(upperLoserPlaceholder(1, 1));
    expect(localizeBracketPlaceholder("Perdant match 3 du upper R2 bis")).toBe("Perdant match 3 du upper R2 bis");
  });

  it("garde null", () => {
    expect(localizeBracketPlaceholder(null)).toBeNull();
  });
});
