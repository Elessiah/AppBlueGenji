import { describe, expect, it } from "@jest/globals";
import { prodOptions, prodPickable, type ProdPanelView } from "@/app/(secured)/tournois/[id]/_lib/prod-dialog";

const panel = (prodId: number | null): ProdPanelView => ({
  matchId: 1,
  prod: prodId === null ? null : { userId: prodId, pseudo: "Current" },
  candidates: [
    { userId: 1, pseudo: "Free", block: null },
    { userId: 2, pseudo: "Current", block: null },
    { userId: 3, pseudo: "Player", block: "PROD_IS_PLAYER" },
    { userId: 4, pseudo: "Caster", block: "PROD_IS_CASTER" },
  ],
});

describe("prodOptions", () => {
  it("prodOptions_currentProd_isExcluded", () => {
    expect(prodOptions(panel(2)).map((c) => c.userId)).toEqual([1, 3, 4]);
  });

  it("prodOptions_blockedCandidates_areKept", () => {
    expect(prodOptions(panel(null)).filter((c) => c.block !== null).map((c) => c.userId)).toEqual([3, 4]);
  });

  it("prodOptions_noProd_returnsEveryCandidate", () => {
    expect(prodOptions(panel(null))).toHaveLength(4);
  });
});

describe("prodPickable", () => {
  it("prodPickable_blockedAndCurrent_areExcluded", () => {
    expect(prodPickable(panel(2)).map((c) => c.userId)).toEqual([1]);
  });
});
