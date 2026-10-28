import { describe, expect, it } from "@jest/globals";
import {
  addMapToSlot,
  chunkRounds,
  findRound,
  overwrittenRounds,
  removeMapFromSlot,
  sameSlots,
  slotGap,
  slotHasMap,
  slotsToEdit,
  slotsToSave,
  toggleMapInSlot,
} from "@/app/(secured)/tournois/[id]/_lib/round-maps-editor";
import { formatMapRulesLog, formatRoundMapsLog } from "@/lib/shared/bot-logs";
import { ROUND_MAP_CANDIDATES_MAX, roundMapsSummary, type RoundMapConfig } from "@/lib/shared/round-maps";

/** Saisie de la fenêtre « Cartes et bans » et journal du staff (`docs/features/ROUND_MAPS.md`). */

const ROUND_1 = { phaseId: 0, bracket: "UPPER", roundNumber: 1 };
const ROUND_2 = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };
const ROUND_3 = { phaseId: 0, bracket: "UPPER", roundNumber: 3 };
const SAVED: RoundMapConfig[] = [
  { ...ROUND_1, slots: [["Ilios"]] },
  { ...ROUND_2, slots: [["Busan", "Nepal"]] },
];

describe("addMapToSlot", () => {
  it("addMapToSlot_newMap_appendsTrimmedName", () => {
    expect(addMapToSlot(["Ilios"], "  Busan ")).toEqual({ slot: ["Ilios", "Busan"], refused: null });
  });

  it("addMapToSlot_blankName_refusedEmpty", () => {
    expect(addMapToSlot(["Ilios"], "   ").refused).toBe("EMPTY");
  });

  it("addMapToSlot_sixtyFourCharacters_accepted", () => {
    expect(addMapToSlot([], "a".repeat(64))).toEqual({ slot: ["a".repeat(64)], refused: null });
  });

  it("addMapToSlot_sixtyFiveCharacters_refusedTooLong", () => {
    expect(addMapToSlot([], "a".repeat(65)).refused).toBe("TOO_LONG");
  });

  it("addMapToSlot_sameMapOtherCase_leavesSlotUnchanged", () => {
    expect(addMapToSlot(["Ilios"], "ILIOS")).toEqual({ slot: ["Ilios"], refused: null });
  });

  it("addMapToSlot_fullPool_refusedPoolFull", () => {
    const full = Array.from({ length: ROUND_MAP_CANDIDATES_MAX }, (_, index) => `Carte ${index}`);
    expect(addMapToSlot(full, "Ilios").refused).toBe("POOL_FULL");
  });
});

describe("removeMapFromSlot / toggleMapInSlot / slotHasMap", () => {
  it("removeMapFromSlot_otherCase_removesMap", () => {
    expect(removeMapFromSlot(["Ilios", "Busan"], "ilios")).toEqual(["Busan"]);
  });

  it("toggleMapInSlot_absentMap_addsIt", () => {
    expect(toggleMapInSlot(["Ilios"], "Busan")).toEqual({ slot: ["Ilios", "Busan"], refused: null });
  });

  it("toggleMapInSlot_presentMap_removesIt", () => {
    expect(toggleMapInSlot(["Ilios", "Busan"], "Ilios")).toEqual({ slot: ["Busan"], refused: null });
  });

  it("slotHasMap_otherCase_returnsTrue", () => {
    expect(slotHasMap(["Paraíso"], "PARAÍSO")).toBe(true);
  });
});

describe("slotsToSave / slotsToEdit / sameSlots", () => {
  it("slotsToSave_emptySlots_dropped", () => {
    expect(slotsToSave([["Ilios"], [], ["Busan", "Nepal"]])).toEqual([["Ilios"], ["Busan", "Nepal"]]);
  });

  it("slotsToEdit_savedRound_returnsCopyOfSlots", () => {
    expect(slotsToEdit(SAVED, ROUND_2)).toEqual([["Busan", "Nepal"]]);
  });

  it("slotsToEdit_roundWithoutConfig_opensOneEmptySlot", () => {
    expect(slotsToEdit(SAVED, ROUND_3)).toEqual([[]]);
  });

  it("slotsToEdit_noRound_opensOneEmptySlot", () => {
    expect(slotsToEdit(SAVED, null)).toEqual([[]]);
  });

  it("sameSlots_differentOrder_returnsFalse", () => {
    expect(sameSlots([["Ilios"], ["Busan"]], [["Busan"], ["Ilios"]])).toBe(false);
  });
});

describe("slotGap", () => {
  it("slotGap_emptyMiddleSlot_returnsItsNumber", () => {
    expect(slotGap([["Ilios"], [], ["Busan"]])).toBe(2);
  });

  it("slotGap_onlyTrailingEmpty_returnsNull", () => {
    expect(slotGap([["Ilios"], []])).toBeNull();
  });

  it("slotGap_allEmpty_returnsNull", () => {
    expect(slotGap([[]])).toBeNull();
  });
});

describe("chunkRounds", () => {
  it("chunkRounds_overSize_splitsIntoBatches", () => {
    expect(chunkRounds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("chunkRounds_exactlySize_singleBatch", () => {
    expect(chunkRounds([1, 2], 2)).toEqual([[1, 2]]);
  });
});

describe("overwrittenRounds", () => {
  it("overwrittenRounds_targetsWithOtherConfig_listed", () => {
    expect(overwrittenRounds(SAVED, [ROUND_1, ROUND_2, ROUND_3], [["Ilios"]])).toEqual([ROUND_2]);
  });

  it("overwrittenRounds_onlyUnsetTargets_returnsEmpty", () => {
    expect(overwrittenRounds(SAVED, [ROUND_3], [["Ilios"]])).toEqual([]);
  });
});

describe("findRound", () => {
  it("findRound_knownId_returnsRound", () => {
    expect(findRound([ROUND_1, ROUND_2], "0:UPPER:2")).toEqual(ROUND_2);
  });

  it("findRound_unknownId_returnsNull", () => {
    expect(findRound([ROUND_1], "0:LOWER:1")).toBeNull();
  });
});

describe("roundMapsSummary", () => {
  it("roundMapsSummary_mixedSlots_countsImposedAndPools", () => {
    expect(roundMapsSummary([["Ilios"], ["Busan", "Nepal"], ["Oasis"]])).toEqual({ maps: 3, imposed: 2, pools: 1 });
  });

  it("roundMapsSummary_noSlot_countsZero", () => {
    expect(roundMapsSummary([])).toEqual({ maps: 0, imposed: 0, pools: 0 });
  });
});

describe("journal des cartes de manche", () => {
  const tournament = { id: 7, name: "Coupe" };

  it("compte cartes imposées et pools, staff anonyme", () => {
    const log = formatRoundMapsLog({ tournament, roundLabel: "Round 2", slots: 3, imposed: 2 });
    expect(log).toContain("Round 2 — 3 cartes (2 imposées, 1 pool), par le staff.");
  });

  it("un seul créneau, accords au singulier", () => {
    expect(formatRoundMapsLog({ tournament, roundLabel: "Round 1", slots: 1, imposed: 1 })).toContain(
      "1 carte (1 imposée, 0 pool)",
    );
  });

  it("zéro créneau : réglage retiré", () => {
    expect(formatRoundMapsLog({ tournament, roundLabel: "Round 1", slots: 0, imposed: 0 })).toContain(
      "Cartes de manche retirées",
    );
  });

  it("règles de ban modifiées, sans nommer personne", () => {
    expect(formatMapRulesLog({ tournament })).toContain("Règles de ban modifiées");
    expect(formatMapRulesLog({ tournament })).toContain("par le staff");
  });
});
