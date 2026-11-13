import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { parseLoggedMapPoints } from "@/lib/server/tournaments/bot-logs";

/**
 * Points des cartes d'un match en format Duel / Arcade, lus de la colonne
 * agrégée du journal (`docs/features/DUEL_ARCADE.md`).
 */

describe("parseLoggedMapPoints", () => {
  it("parseLoggedMapPoints_twoMaps_returnsBoardOrderedPoints", () => {
    expect(parseLoggedMapPoints("5-3,2-5")).toEqual([
      { team1Score: 5, team2Score: 3 },
      { team1Score: 2, team2Score: 5 },
    ]);
  });

  it("parseLoggedMapPoints_null_returnsNull", () => {
    expect(parseLoggedMapPoints(null)).toBeNull();
  });

  it("parseLoggedMapPoints_emptyString_returnsNull", () => {
    expect(parseLoggedMapPoints("")).toBeNull();
  });

  it("parseLoggedMapPoints_malformedPart_returnsNull", () => {
    expect(parseLoggedMapPoints("5-3,x-1")).toBeNull();
  });

  it("parseLoggedMapPoints_threeDigitScore_returnsNull", () => {
    expect(parseLoggedMapPoints("100-3")).toBeNull();
  });
});
