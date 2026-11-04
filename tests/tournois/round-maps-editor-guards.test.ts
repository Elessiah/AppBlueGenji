import { describe, expect, it } from "@jest/globals";
import {
  firstTargetOverMax,
  focusIndexAfterRemoval,
  slotOverMax,
  vanishedRoundFallback,
} from "@/app/(secured)/tournois/[id]/_lib/round-maps-editor";

/** Gardes de la fenêtre « Cartes et bans » : carte de trop, focus rendu, tour disparu (`docs/features/ROUND_MAPS.md`). */

const R1 = { phaseId: 0, bracket: "UPPER", roundNumber: 1 };
const R2 = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };

describe("slotOverMax", () => {
  it("slotOverMax_noCap_returnsNull", () => {
    expect(slotOverMax([["a"], ["b"], ["c"]], null)).toBeNull();
  });

  it("slotOverMax_exactlyMax_returnsNull", () => {
    expect(slotOverMax([["a"], ["b"]], 2)).toBeNull();
  });

  it("slotOverMax_oneOverMax_returnsNumberOfThirdSlot", () => {
    expect(slotOverMax([["a"], ["b"], ["c"]], 2)).toBe(3);
  });

  it("slotOverMax_emptySlotsBetween_notCountedAndPositionKept", () => {
    expect(slotOverMax([["a"], [], ["b"], ["c"]], 2)).toBe(4);
  });

  it("slotOverMax_onlyEmptySlots_returnsNull", () => {
    expect(slotOverMax([[], []], 1)).toBeNull();
  });
});

describe("focusIndexAfterRemoval", () => {
  it("focusIndexAfterRemoval_removedMiddle_returnsSameIndex", () => {
    expect(focusIndexAfterRemoval(1, 3)).toBe(1);
  });

  it("focusIndexAfterRemoval_removedLast_returnsLastRemaining", () => {
    expect(focusIndexAfterRemoval(2, 2)).toBe(1);
  });

  it("focusIndexAfterRemoval_noneRemaining_returnsNull", () => {
    expect(focusIndexAfterRemoval(0, 0)).toBeNull();
  });
});

describe("vanishedRoundFallback", () => {
  it("vanishedRoundFallback_roundStillListed_returnsNull", () => {
    expect(vanishedRoundFallback([R1, R2], "0:UPPER:2")).toBeNull();
  });

  it("vanishedRoundFallback_roundGone_returnsFirstRoundId", () => {
    expect(vanishedRoundFallback([R1], "0:UPPER:2")).toBe("0:UPPER:1");
  });

  it("vanishedRoundFallback_noRoundsAndEmptyId_returnsNull", () => {
    expect(vanishedRoundFallback([], "")).toBeNull();
  });

  it("vanishedRoundFallback_noRoundsAndStaleId_returnsEmptyString", () => {
    expect(vanishedRoundFallback([], "0:UPPER:2")).toBe("");
  });

  it("vanishedRoundFallback_emptyIdWithRoundsAvailable_returnsFirstRoundId", () => {
    expect(vanishedRoundFallback([R2, R1], "")).toBe("0:UPPER:2");
  });
});

describe("firstTargetOverMax", () => {
  const limits: Record<number, number | null> = { 1: 1, 2: 3, 3: 5, 4: null };
  const limitOf = (target: { roundNumber: number }) => limits[target.roundNumber] ?? null;

  it("firstTargetOverMax_everyTargetFits_returnsNull", () => {
    expect(firstTargetOverMax([R2, { ...R2, roundNumber: 3 }], 3, limitOf)).toBeNull();
  });

  it("firstTargetOverMax_severalTooSmall_returnsTheFirstOffender", () => {
    expect(firstTargetOverMax([R2, R1, { ...R2, roundNumber: 3 }], 4, limitOf)).toBe(R2);
  });

  it("firstTargetOverMax_targetWithoutCap_isIgnored", () => {
    expect(firstTargetOverMax([{ ...R2, roundNumber: 4 }], 20, limitOf)).toBeNull();
  });

  it("firstTargetOverMax_noTargets_returnsNull", () => {
    expect(firstTargetOverMax([], 3, limitOf)).toBeNull();
  });
});
