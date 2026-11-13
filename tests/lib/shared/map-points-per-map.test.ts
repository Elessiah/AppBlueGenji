import { describe, expect, it } from "@jest/globals";
import {
  MAP_POINT_TARGET_MAX,
  MAP_POINT_TARGET_MIN,
  clipMapPointTargets,
  effectiveMapPointTargets,
  hasPerMapTargets,
  mapPointTargetAt,
  normalizeMapPointTargets,
  parseStoredMapPointTargets,
  roundMapPointTargetsOf,
  sameMapPointTargets,
  serializeMapPointTargets,
  trimMapPointTargets,
} from "@/lib/shared/map-points";
import {
  checkMapList,
  mapRulesAt,
  progressiveMapRows,
  refusalPointTarget,
  type MatchMapInput,
} from "@/lib/shared/match-maps";
import type { MatchFormat } from "@/lib/shared/match-format";
import type { RoundKey } from "@/lib/shared/round-maps";
import {
  editMapPointDraft,
  invalidPointField,
  mapPointDrafts,
  mapPointRowCount,
} from "@/app/(secured)/tournois/[id]/_lib/round-points-editor";

/**
 * Points par carte, format Duel / Arcade (`docs/features/DUEL_ARCADE.md`) :
 * chaque carte d'un tour peut avoir son propre « premier à N » ; résolution
 * carte, puis tour, puis tournoi.
 */

const ROUND: RoundKey = { phaseId: 0, bracket: "UPPER", roundNumber: 1 };
const BO3: MatchFormat = { type: "BO", value: 3 };

function map(team1Score: number, team2Score: number): MatchMapInput {
  return { replayCode: "", team1Score, team2Score };
}

describe("normalizeMapPointTargets", () => {
  it("normalizeMapPointTargets_validList_trimsTrailingNulls", () => {
    expect(normalizeMapPointTargets([null, 3, 7, null])).toEqual([null, 3, 7]);
  });

  it("normalizeMapPointTargets_allNulls_returnsEmpty", () => {
    expect(normalizeMapPointTargets([null, null])).toEqual([]);
  });

  it("normalizeMapPointTargets_notArray_throws", () => {
    expect(() => normalizeMapPointTargets("3")).toThrow("INVALID_MAP_POINT_TARGET");
  });

  it("normalizeMapPointTargets_nineEntries_accepted", () => {
    expect(normalizeMapPointTargets([1, 2, 3, 4, 5, 6, 7, 8, 9])).toHaveLength(9);
  });

  it("normalizeMapPointTargets_tenEntries_throws", () => {
    expect(() => normalizeMapPointTargets([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toThrow("INVALID_MAP_POINT_TARGET");
  });

  it("normalizeMapPointTargets_belowMin_throws", () => {
    expect(() => normalizeMapPointTargets([MAP_POINT_TARGET_MIN - 1])).toThrow("INVALID_MAP_POINT_TARGET");
  });

  it("normalizeMapPointTargets_aboveMax_throws", () => {
    expect(() => normalizeMapPointTargets([MAP_POINT_TARGET_MAX + 1])).toThrow("INVALID_MAP_POINT_TARGET");
  });

  it("normalizeMapPointTargets_boundValues_accepted", () => {
    expect(normalizeMapPointTargets([MAP_POINT_TARGET_MIN, MAP_POINT_TARGET_MAX])).toEqual([1, 99]);
  });

  it("normalizeMapPointTargets_nonInteger_throws", () => {
    expect(() => normalizeMapPointTargets([2.5])).toThrow("INVALID_MAP_POINT_TARGET");
  });

  it("normalizeMapPointTargets_numericString_throws", () => {
    expect(() => normalizeMapPointTargets(["3"])).toThrow("INVALID_MAP_POINT_TARGET");
  });
});

describe("parseStoredMapPointTargets", () => {
  it("parseStoredMapPointTargets_validJson_parses", () => {
    expect(parseStoredMapPointTargets("[null,3,7]")).toEqual([null, 3, 7]);
  });

  it("parseStoredMapPointTargets_null_returnsEmpty", () => {
    expect(parseStoredMapPointTargets(null)).toEqual([]);
  });

  it("parseStoredMapPointTargets_emptyString_returnsEmpty", () => {
    expect(parseStoredMapPointTargets("")).toEqual([]);
  });

  it("parseStoredMapPointTargets_badJson_returnsEmpty", () => {
    expect(parseStoredMapPointTargets("{")).toEqual([]);
  });

  it("parseStoredMapPointTargets_notArray_returnsEmpty", () => {
    expect(parseStoredMapPointTargets("{}")).toEqual([]);
  });

  it("parseStoredMapPointTargets_invalidEntry_becomesNull", () => {
    expect(parseStoredMapPointTargets("[0,3]")).toEqual([null, 3]);
  });

  it("parseStoredMapPointTargets_overLong_keepsNine", () => {
    expect(parseStoredMapPointTargets("[1,2,3,4,5,6,7,8,9,10,11,12]")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("parseStoredMapPointTargets_alreadyParsedArray_reads", () => {
    expect(parseStoredMapPointTargets([4, null])).toEqual([4]);
  });
});

describe("serializeMapPointTargets", () => {
  it("serializeMapPointTargets_empty_returnsNull", () => {
    expect(serializeMapPointTargets([])).toBeNull();
  });

  it("serializeMapPointTargets_list_returnsJson", () => {
    expect(serializeMapPointTargets([null, 3])).toBe("[null,3]");
  });
});

describe("roundMapPointTargetsOf", () => {
  it("roundMapPointTargetsOf_matchingRound_returnsTargets", () => {
    expect(roundMapPointTargetsOf([{ ...ROUND, targets: [null, 3] }], ROUND)).toEqual([null, 3]);
  });

  it("roundMapPointTargetsOf_otherRound_returnsEmpty", () => {
    expect(roundMapPointTargetsOf([{ ...ROUND, roundNumber: 2, targets: [3] }], ROUND)).toEqual([]);
  });

  it("roundMapPointTargetsOf_noList_returnsEmpty", () => {
    expect(roundMapPointTargetsOf(undefined, ROUND)).toEqual([]);
  });
});

describe("effectiveMapPointTargets", () => {
  it("effectiveMapPointTargets_formatOff_returnsNull", () => {
    expect(effectiveMapPointTargets(null, [3])).toBeNull();
  });

  it("effectiveMapPointTargets_emptyList_returnsNull", () => {
    expect(effectiveMapPointTargets(5, [])).toBeNull();
  });

  it("effectiveMapPointTargets_onlyNulls_returnsNull", () => {
    expect(effectiveMapPointTargets(5, [null])).toBeNull();
  });

  it("effectiveMapPointTargets_mixed_fillsWithRoundTarget", () => {
    expect(effectiveMapPointTargets(5, [null, 3])).toEqual([5, 3]);
  });
});

describe("mapPointTargetAt", () => {
  it("mapPointTargetAt_formatOff_returnsNull", () => {
    expect(mapPointTargetAt(null, [3], 0)).toBeNull();
  });

  it("mapPointTargetAt_ownMap_returnsMapTarget", () => {
    expect(mapPointTargetAt(5, [3, 7], 1)).toBe(7);
  });

  it("mapPointTargetAt_beyondList_returnsMatchTarget", () => {
    expect(mapPointTargetAt(5, [3, 7], 2)).toBe(5);
  });
});

describe("hasPerMapTargets", () => {
  it("hasPerMapTargets_allEqual_false", () => {
    expect(hasPerMapTargets(5, [5, 5])).toBe(false);
  });

  it("hasPerMapTargets_oneDiffers_true", () => {
    expect(hasPerMapTargets(5, [5, 3])).toBe(true);
  });

  it("hasPerMapTargets_formatOff_false", () => {
    expect(hasPerMapTargets(null, [3])).toBe(false);
  });
});

describe("checkMapList — points par carte", () => {
  const RULES = { decisive: true, requireReplayCode: false, pointTarget: 5, pointTargets: [3, 7] };

  it("checkMapList_perMapTargets_acceptsEachMapAtItsOwnTarget", () => {
    const actual = checkMapList(BO3, "OW", [map(3, 1), map(7, 2)], RULES);

    expect(actual.error).toBeNull();
  });

  it("checkMapList_mapAtRoundTargetInsteadOfOwn_refusesThatMap", () => {
    const actual = checkMapList(BO3, "OW", [map(3, 1), map(5, 2)], RULES);

    expect(actual).toMatchObject({ error: "MAP_POINTS_INVALID", field: { index: 1 } });
  });

  it("checkMapList_mapBeyondList_usesMatchTarget", () => {
    const actual = checkMapList(BO3, "OW", [map(3, 1), map(2, 7), map(5, 4)], RULES);

    expect(actual.error).toBeNull();
  });
});

describe("refusalPointTarget", () => {
  it("refusalPointTarget_fieldOnSecondMap_returnsThatMapsTarget", () => {
    const actual = refusalPointTarget(
      { field: { index: 1, field: "team1Score" } },
      { pointTarget: 5, pointTargets: [3, 7] },
    );

    expect(actual).toBe(7);
  });

  it("refusalPointTarget_noField_returnsFirstMapTarget", () => {
    expect(refusalPointTarget({ field: null }, { pointTarget: 5, pointTargets: [3, 7] })).toBe(3);
  });
});

describe("mapRulesAt", () => {
  it("mapRulesAt_index_returnsMapTargetAsPointTarget", () => {
    expect(mapRulesAt({ requireReplayCode: false, pointTarget: 5, pointTargets: [3] }, 0)).toEqual({
      requireReplayCode: false,
      pointTarget: 3,
    });
  });
});

describe("progressiveMapRows — points par carte", () => {
  it("progressiveMapRows_lastMapCompleteAtOwnTarget_opensNextRow", () => {
    const actual = progressiveMapRows(BO3, "OW", [map(3, 0)], { requireReplayCode: false, pointTarget: 5, pointTargets: [3] });

    expect(actual).toHaveLength(2);
  });

  it("progressiveMapRows_lastMapAtRoundTargetBelowOwn_opensNothing", () => {
    const actual = progressiveMapRows(BO3, "OW", [map(5, 0)], { requireReplayCode: false, pointTarget: 5, pointTargets: [7] });

    expect(actual).toHaveLength(1);
  });
});

describe("clipMapPointTargets", () => {
  it("clipMapPointTargets_freeScore_keepsAllTrimmed", () => {
    expect(clipMapPointTargets([3, null, 7, null], null)).toEqual([3, null, 7]);
  });

  it("clipMapPointTargets_longerThanMax_cutsAndTrims", () => {
    expect(clipMapPointTargets([3, 7, null, 9], 2)).toEqual([3, 7]);
  });

  it("clipMapPointTargets_onlyBeyondMax_returnsEmpty", () => {
    expect(clipMapPointTargets([null, null, 9], 2)).toEqual([]);
  });

  it("clipMapPointTargets_maxAtLength_unchanged", () => {
    expect(clipMapPointTargets([3, 7], 2)).toEqual([3, 7]);
  });
});

describe("mapPointRowCount", () => {
  it("mapPointRowCount_bo3_returnsThree", () => {
    expect(mapPointRowCount(3)).toBe(3);
  });

  it("mapPointRowCount_freeScore_returnsNine", () => {
    expect(mapPointRowCount(null)).toBe(9);
  });

  it("mapPointRowCount_aboveCap_returnsNine", () => {
    expect(mapPointRowCount(12)).toBe(9);
  });

  it("mapPointRowCount_singleMap_returnsZero", () => {
    expect(mapPointRowCount(1)).toBe(0);
  });
});

describe("mapPointDrafts", () => {
  it("mapPointDrafts_savedEqualToRound_keepsExplicitValueAndPads", () => {
    expect(mapPointDrafts([7, 3], 3)).toEqual([7, 3, null]);
  });
});

describe("editMapPointDraft", () => {
  it("editMapPointDraft_valueEqualToRound_followsRound", () => {
    expect(editMapPointDraft([3, 7], 1, 5, 5)).toEqual([3, null]);
  });

  it("editMapPointDraft_otherValue_setsIt", () => {
    expect(editMapPointDraft([null, null], 0, 4, 5)).toEqual([4, null]);
  });
});

describe("trimMapPointTargets (envoi de l'écran)", () => {
  // Une carte réglée à 7 garde son 7 quand le tour vaut aussi 7 : elle ne
  // devient pas une carte qui suit le tour.
  it("trimMapPointTargets_explicitEqualToRound_kept", () => {
    expect(trimMapPointTargets([null, 7, null])).toEqual([null, 7]);
  });
});

describe("invalidPointField", () => {
  it("invalidPointField_outOfBoundsMap_pointsThatMap", () => {
    expect(invalidPointField([3, MAP_POINT_TARGET_MAX + 1], 3)).toBe("map-1");
  });

  it("invalidPointField_tooLongForFormat_pointsLastShownMap", () => {
    expect(invalidPointField([3, 5, 7, 9], 3)).toBe("map-2");
  });

  it("invalidPointField_roundTargetOutOfBounds_pointsRoundField", () => {
    expect(invalidPointField([3, 5], 3, MAP_POINT_TARGET_MAX + 1)).toBe("points");
  });

  it("invalidPointField_roundTargetAndMapBothInvalid_roundFieldWins", () => {
    expect(invalidPointField([MAP_POINT_TARGET_MAX + 1], 3, 0)).toBe("points");
  });

  it("invalidPointField_roundTargetValidMapInvalid_stillPointsMap", () => {
    expect(invalidPointField([3, MAP_POINT_TARGET_MAX + 1], 3, 5)).toBe("map-1");
  });

  it("invalidPointField_allValid_pointsRoundField", () => {
    expect(invalidPointField([3, 5], 3)).toBe("points");
  });
});

describe("sameMapPointTargets", () => {
  it("sameMapPointTargets_equal_true", () => {
    expect(sameMapPointTargets([null, 3], [null, 3])).toBe(true);
  });

  it("sameMapPointTargets_differentLength_false", () => {
    expect(sameMapPointTargets([3], [3, 4])).toBe(false);
  });

  it("sameMapPointTargets_differentValue_false", () => {
    expect(sameMapPointTargets([3], [4])).toBe(false);
  });
});
