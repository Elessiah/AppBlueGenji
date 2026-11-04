import { describe, expect, it } from "@jest/globals";
import { matchMapPlan, roundTiebreakOf, type RoundMapConfig } from "@/lib/shared/round-maps";

/** Map de départage et cartes d'un match pour la saisie du score (`docs/features/ROUND_MAPS.md`). */

const ROUND = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };
const MATCH = { ...ROUND, firstMap: null, mapPicks: {} };

describe("roundTiebreakOf", () => {
  it("roundTiebreakOf_noMatchingRound_returnsNull", () => {
    expect(roundTiebreakOf([{ ...ROUND, roundNumber: 3, map: "Ilios" }], MATCH)).toBeNull();
  });

  it("roundTiebreakOf_undefinedList_returnsNull", () => {
    expect(roundTiebreakOf(undefined, MATCH)).toBeNull();
  });

  it("roundTiebreakOf_matchingRound_returnsName", () => {
    expect(roundTiebreakOf([{ ...ROUND, map: "Ilios" }], MATCH)).toBe("Ilios");
  });

  it("roundTiebreakOf_nameWithInvisibleCharacters_returnsVisibleText", () => {
    expect(roundTiebreakOf([{ ...ROUND, map: "Ilios​\u0007" }], MATCH)).toBe("Ilios");
  });

  it("roundTiebreakOf_blankAfterCleaning_returnsNull", () => {
    expect(roundTiebreakOf([{ ...ROUND, map: "​" }], MATCH)).toBeNull();
  });
});

describe("matchMapPlan", () => {
  const rounds: RoundMapConfig[] = [{ ...ROUND, slots: [["Ilios"], ["Busan", "Nepal"]] }];

  it("matchMapPlan_noRules_returnsEmptyPlan", () => {
    expect(matchMapPlan(undefined, MATCH)).toEqual({ mapNames: [], tiebreakMap: null });
  });

  it("matchMapPlan_noMatch_returnsEmptyPlan", () => {
    expect(matchMapPlan({ rounds, tiebreaks: [] }, null)).toEqual({ mapNames: [], tiebreakMap: null });
  });

  it("matchMapPlan_ruleWithTiebreak_returnsNamesAndTiebreak", () => {
    const plan = matchMapPlan({ rounds, tiebreaks: [{ ...ROUND, map: "Oasis" }] }, MATCH);

    expect(plan).toEqual({ mapNames: ["Ilios", null], tiebreakMap: "Oasis" });
  });

  it("matchMapPlan_noRulesTwice_returnsSameReference", () => {
    expect(matchMapPlan(undefined, MATCH)).toBe(matchMapPlan(null, null));
  });
});
