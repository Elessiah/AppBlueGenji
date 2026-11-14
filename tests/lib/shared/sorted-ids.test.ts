import { describe, expect, it } from "@jest/globals";
import { sortedIdsInclude } from "@/lib/shared/sorted-ids";

/* EF-62 (revue standard, cycle 4) : recherche dichotomique dans une liste triée. */
describe("sortedIdsInclude", () => {
  it("sortedIdsInclude_emptyList_returnsFalse", () => {
    expect(sortedIdsInclude([], 5)).toBe(false);
  });

  it("sortedIdsInclude_singleElementMatch_returnsTrue", () => {
    expect(sortedIdsInclude([5], 5)).toBe(true);
  });

  it("sortedIdsInclude_eachPositionOfEvenLengthList_returnsTrue", () => {
    const ids = [1, 3, 5, 7];

    expect(sortedIdsInclude(ids, 1)).toBe(true);
    expect(sortedIdsInclude(ids, 3)).toBe(true);
    expect(sortedIdsInclude(ids, 5)).toBe(true);
    expect(sortedIdsInclude(ids, 7)).toBe(true);
  });

  it("sortedIdsInclude_eachPositionOfOddLengthList_returnsTrue", () => {
    const ids = [1, 3, 5];

    expect(sortedIdsInclude(ids, 1)).toBe(true);
    expect(sortedIdsInclude(ids, 3)).toBe(true);
    expect(sortedIdsInclude(ids, 5)).toBe(true);
  });

  it("sortedIdsInclude_absentBelowAboveOrBetween_returnsFalse", () => {
    const ids = [1, 3, 5, 7];

    expect(sortedIdsInclude(ids, 0)).toBe(false);
    expect(sortedIdsInclude(ids, 9)).toBe(false);
    expect(sortedIdsInclude(ids, 4)).toBe(false);
  });
});
