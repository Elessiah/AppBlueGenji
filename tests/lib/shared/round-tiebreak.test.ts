import { describe, expect, it } from "@jest/globals";
import { formatLobbyBriefDm } from "@/lib/server/tournaments/lobby-brief-dm";
import type { LobbyBriefSide } from "@/lib/shared/lobby-brief";
import { formatAllowsTiebreak, type MatchFormat } from "@/lib/shared/match-format";
import { checkMapList, tiebreakRowIndex } from "@/lib/shared/match-maps";
import { normalizeTiebreakMap, parseStoredTiebreak, roundTiebreakOf } from "@/lib/shared/round-maps";
import {
  applicableTiebreaks,
  isPlayoffRound,
  roundAllowsTiebreak,
  tiebreakTournamentFromRow,
  type TiebreakTournament,
} from "@/lib/shared/round-plan";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";

/**
 * Map de départage des play-offs en vrai best of 3 (`docs/features/ROUND_MAPS.md`) :
 * éligibilité d'un tour, ligne de la saisie qui la joue, normalisation, brief.
 */

const BO3: MatchFormat = { type: "BO", value: 3 };
const FT2: MatchFormat = { type: "FT", value: 2 };
const FT3: MatchFormat = { type: "FT", value: 3 };
const UPPER_1 = { phaseId: 0, bracket: "UPPER", roundNumber: 1 };

function tournament(overrides: Partial<TiebreakTournament> = {}): TiebreakTournament {
  return { format: "SINGLE", matchFormat: BO3, endurancePlayoffFormat: null, phases: null, ...overrides };
}

const map = (team1Score: number, team2Score: number) => ({ team1Score, team2Score });

describe("formatAllowsTiebreak", () => {
  it("formatAllowsTiebreak_bo3_returnsTrue", () => {
    expect(formatAllowsTiebreak(BO3)).toBe(true);
  });

  it("formatAllowsTiebreak_ft2_returnsTrue", () => {
    expect(formatAllowsTiebreak(FT2)).toBe(true);
  });

  it("formatAllowsTiebreak_ft3_returnsTrue", () => {
    expect(formatAllowsTiebreak(FT3)).toBe(true);
  });

  it("formatAllowsTiebreak_bo3WithDraws_returnsFalse", () => {
    expect(formatAllowsTiebreak({ ...BO3, drawsAllowed: true })).toBe(false);
  });

  it("formatAllowsTiebreak_nullFormat_returnsFalse", () => {
    expect(formatAllowsTiebreak(null)).toBe(false);
  });
});

describe("tiebreakRowIndex", () => {
  it("tiebreakRowIndex_levelOneAllAfterThreeMapsWithFourthRow_returnsThree", () => {
    expect(tiebreakRowIndex(BO3, [map(3, 1), map(0, 2), map(2, 2), map(0, 0)], "Ilios")).toBe(3);
  });

  it("tiebreakRowIndex_threeDrawnMapsWithFourthRow_returnsNull", () => {
    expect(tiebreakRowIndex(BO3, [map(1, 1), map(2, 2), map(0, 0), map(1, 0)], "Ilios")).toBeNull();
  });

  it("tiebreakRowIndex_levelOneAllOnlyAfterFourthRow_returnsFour", () => {
    expect(tiebreakRowIndex(BO3, [map(1, 1), map(2, 0), map(0, 0), map(0, 2), map(1, 0)], "Ilios")).toBe(4);
  });

  it("tiebreakRowIndex_levelOneAllAfterFourthRowWithoutFifthRow_returnsNull", () => {
    expect(tiebreakRowIndex(BO3, [map(1, 1), map(2, 0), map(0, 0), map(0, 2)], "Ilios")).toBeNull();
  });

  it("tiebreakRowIndex_unevenAfterDraws_returnsNull", () => {
    expect(tiebreakRowIndex(BO3, [map(0, 2), map(1, 1), map(2, 2), map(1, 0)], "Ilios")).toBeNull();
  });

  it("tiebreakRowIndex_onlyThreeRows_returnsNull", () => {
    expect(tiebreakRowIndex(BO3, [map(3, 1), map(0, 2), map(2, 2)], "Ilios")).toBeNull();
  });

  it("tiebreakRowIndex_noTiebreakMap_returnsNull", () => {
    expect(tiebreakRowIndex(BO3, [map(3, 1), map(0, 2), map(2, 2), map(0, 0)], null)).toBeNull();
  });

  it("tiebreakRowIndex_ft3Format_returnsNull", () => {
    expect(tiebreakRowIndex(FT3, [map(3, 1), map(0, 2), map(2, 2), map(0, 0)], "Ilios")).toBeNull();
  });
});

describe("normalizeTiebreakMap", () => {
  it("normalizeTiebreakMap_name_returnsVisibleText", () => {
    expect(normalizeTiebreakMap("  Ilios  ")).toBe("Ilios");
  });

  it("normalizeTiebreakMap_null_returnsNull", () => {
    expect(normalizeTiebreakMap(null)).toBeNull();
  });

  it("normalizeTiebreakMap_emptyString_returnsNull", () => {
    expect(normalizeTiebreakMap("   ")).toBeNull();
  });

  it("normalizeTiebreakMap_nonString_throwsInvalidTiebreakMap", () => {
    expect(() => normalizeTiebreakMap(42)).toThrow("INVALID_TIEBREAK_MAP");
  });

  it("normalizeTiebreakMap_64Characters_accepted", () => {
    expect(normalizeTiebreakMap("a".repeat(64))).toBe("a".repeat(64));
  });

  it("normalizeTiebreakMap_65Characters_throwsInvalidTiebreakMap", () => {
    expect(() => normalizeTiebreakMap("a".repeat(65))).toThrow("INVALID_TIEBREAK_MAP");
  });
});

describe("parseStoredTiebreak", () => {
  it("parseStoredTiebreak_tooLong_returnsNull", () => {
    expect(parseStoredTiebreak("a".repeat(65))).toBeNull();
  });

  it("parseStoredTiebreak_null_returnsNull", () => {
    expect(parseStoredTiebreak(null)).toBeNull();
  });
});

describe("roundTiebreakOf", () => {
  const tiebreaks = [{ ...UPPER_1, map: "Ilios" }];

  it("roundTiebreakOf_matchingKey_returnsMap", () => {
    expect(roundTiebreakOf(tiebreaks, UPPER_1)).toBe("Ilios");
  });

  it("roundTiebreakOf_otherKey_returnsNull", () => {
    expect(roundTiebreakOf(tiebreaks, { ...UPPER_1, bracket: "LOWER" })).toBeNull();
  });

  it("roundTiebreakOf_undefinedList_returnsNull", () => {
    expect(roundTiebreakOf(undefined, UPPER_1)).toBeNull();
  });
});

describe("isPlayoffRound", () => {
  it("isPlayoffRound_singleEliminationThirdPlace_returnsTrue", () => {
    expect(isPlayoffRound({ format: "SINGLE", phases: null }, { ...UPPER_1, bracket: "THIRD_PLACE" })).toBe(true);
  });

  it("isPlayoffRound_doubleEliminationLowerBracket_returnsTrue", () => {
    expect(isPlayoffRound({ format: "DOUBLE", phases: null }, { ...UPPER_1, bracket: "LOWER" })).toBe(true);
  });

  it("isPlayoffRound_swiss_returnsFalse", () => {
    expect(isPlayoffRound({ format: "SWISS", phases: null }, UPPER_1)).toBe(false);
  });

  it("isPlayoffRound_survival_returnsFalse", () => {
    expect(isPlayoffRound({ format: "SURVIVAL", phases: null }, UPPER_1)).toBe(false);
  });

  it("isPlayoffRound_bgSurviePlayoffRound_returnsTrue", () => {
    expect(isPlayoffRound({ format: "BG_SURVIE", phases: null }, { ...UPPER_1, roundNumber: PLAYOFF_ROUND_OFFSET })).toBe(true);
  });

  it("isPlayoffRound_bgSurvieQualificationRound_returnsFalse", () => {
    expect(isPlayoffRound({ format: "BG_SURVIE", phases: null }, { ...UPPER_1, roundNumber: PLAYOFF_ROUND_OFFSET - 1 })).toBe(
      false,
    );
  });

  it("isPlayoffRound_multiEliminationPhase_returnsTrue", () => {
    const phases: TiebreakTournament["phases"] = [
      { id: 5, format: "SWISS" },
      { id: 6, format: "SINGLE" },
    ];
    expect(isPlayoffRound({ format: "MULTI", phases }, { ...UPPER_1, phaseId: 6 })).toBe(true);
  });

  it("isPlayoffRound_multiSwissPhase_returnsFalse", () => {
    const phases: TiebreakTournament["phases"] = [{ id: 5, format: "SWISS" }];
    expect(isPlayoffRound({ format: "MULTI", phases }, { ...UPPER_1, phaseId: 5 })).toBe(false);
  });

  it("isPlayoffRound_nonZeroPhaseOutsideMulti_returnsFalse", () => {
    expect(isPlayoffRound({ format: "SINGLE", phases: null }, { ...UPPER_1, phaseId: 3 })).toBe(false);
  });
});

describe("roundAllowsTiebreak", () => {
  it("roundAllowsTiebreak_singleBo3_returnsTrue", () => {
    expect(roundAllowsTiebreak(tournament(), UPPER_1)).toBe(true);
  });

  it("roundAllowsTiebreak_singleFt2_returnsTrue", () => {
    expect(roundAllowsTiebreak(tournament({ matchFormat: FT2 }), UPPER_1)).toBe(true);
  });

  it("roundAllowsTiebreak_singleFt3_returnsTrue", () => {
    expect(roundAllowsTiebreak(tournament({ matchFormat: FT3 }), UPPER_1)).toBe(true);
  });

  it("roundAllowsTiebreak_freeScore_returnsFalse", () => {
    expect(roundAllowsTiebreak(tournament({ matchFormat: null }), UPPER_1)).toBe(false);
  });

  it("roundAllowsTiebreak_swissBo3_returnsFalse", () => {
    expect(roundAllowsTiebreak(tournament({ format: "SWISS" }), UPPER_1)).toBe(false);
  });

  it("roundAllowsTiebreak_bgSurviePlayoffFormatBo3_returnsTrue", () => {
    const bgSurvie = tournament({
      format: "BG_SURVIE",
      matchFormat: { type: "BO", value: 5, drawsAllowed: true },
      endurancePlayoffFormat: BO3,
    });
    expect(roundAllowsTiebreak(bgSurvie, { ...UPPER_1, roundNumber: PLAYOFF_ROUND_OFFSET })).toBe(true);
  });
});

describe("applicableTiebreaks", () => {
  it("applicableTiebreaks_mixedRounds_keepsEligibleOnly", () => {
    const multi = tournament({
      format: "MULTI",
      phases: [
        { id: 5, format: "SWISS" },
        { id: 6, format: "SINGLE" },
      ],
    });
    const actual = applicableTiebreaks(
      [
        { phaseId: 5, bracket: "UPPER", roundNumber: 1, map: "Busan" },
        { phaseId: 6, bracket: "UPPER", roundNumber: 1, map: "Ilios" },
      ],
      multi,
    );
    expect(actual).toEqual([{ phaseId: 6, bracket: "UPPER", roundNumber: 1, map: "Ilios" }]);
  });
});

function side(overrides: Partial<LobbyBriefSide> = {}): LobbyBriefSide {
  return {
    tournamentId: 4,
    tournamentName: "Coupe",
    matchId: 40,
    bracket: "UPPER",
    roundNumber: 2,
    solo: false,
    game: "OW",
    teamName: "Renards",
    opponentName: "Nova",
    hosting: true,
    banFirst: false,
    firstMap: "Ilios",
    maps: [],
    nextBan: "LOSER",
    cast: false,
    ...overrides,
  };
}

describe("formatLobbyBriefDm — map de départage", () => {
  const URL = "https://bluegenji.test/tournois/4/matchs/40";

  it("formatLobbyBriefDm_tiebreakFr_addsLine", () => {
    expect(formatLobbyBriefDm(side({ tiebreakMap: "Busan" }), URL)).toContain(
      "* Map de départage (jouée seulement si la série est à égalité après les maps régulières) : « Busan »",
    );
  });

  it("formatLobbyBriefDm_tiebreakEn_addsLine", () => {
    expect(formatLobbyBriefDm(side({ tiebreakMap: "Busan" }), URL, "en")).toContain(
      "* Tiebreak map (played only if the series is level after the regular maps): “Busan”",
    );
  });

  it("formatLobbyBriefDm_noTiebreak_noLine", () => {
    expect(formatLobbyBriefDm(side({ tiebreakMap: null }), URL)).not.toContain("départage");
  });
});

/**
 * Map de départage étendue à tout format de play-offs (lot TIEBREAK-ALL,
 * 2026-11-09) : jouée en map N + 1 quand la série est à égalité à une map de
 * l'objectif après les N maps régulières.
 */
const BO5: MatchFormat = { type: "BO", value: 5 };
const BO7: MatchFormat = { type: "BO", value: 7 };
const BO5_DRAWS: MatchFormat = { type: "BO", value: 5, drawsAllowed: true };
const PLAYOFF_1 = { ...UPPER_1, roundNumber: PLAYOFF_ROUND_OFFSET };
const coded = (replayCode: string, team1Score: number, team2Score: number) => ({ replayCode, team1Score, team2Score });

describe("formatAllowsTiebreak — tous formats", () => {
  it("formatAllowsTiebreak_bo5_returnsTrue", () => {
    expect(formatAllowsTiebreak(BO5)).toBe(true);
  });

  it("formatAllowsTiebreak_bo5WithDraws_returnsFalse", () => {
    expect(formatAllowsTiebreak(BO5_DRAWS)).toBe(false);
  });
});

describe("tiebreakRowIndex — tous formats", () => {
  it("tiebreakRowIndex_bo5TwoAllAfterFiveMapsWithSixthRow_returnsFive", () => {
    const maps = [map(1, 0), map(0, 1), map(2, 2), map(1, 0), map(0, 1), map(1, 0)];
    expect(tiebreakRowIndex(BO5, maps, "Ilios")).toBe(5);
  });

  it("tiebreakRowIndex_bo5OneAllAfterFiveMaps_returnsNull", () => {
    const maps = [map(1, 0), map(0, 1), map(2, 2), map(1, 1), map(0, 0), map(1, 0)];
    expect(tiebreakRowIndex(BO5, maps, "Ilios")).toBeNull();
  });

  it("tiebreakRowIndex_bo5NotLevelAfterFiveMaps_returnsNull", () => {
    const maps = [map(1, 0), map(1, 0), map(2, 2), map(0, 1), map(0, 0), map(0, 1)];
    expect(tiebreakRowIndex(BO5, maps, "Ilios")).toBeNull();
  });

  it("tiebreakRowIndex_bo5OnlyFiveRows_returnsNull", () => {
    const maps = [map(1, 0), map(0, 1), map(2, 2), map(1, 0), map(0, 1)];
    expect(tiebreakRowIndex(BO5, maps, "Ilios")).toBeNull();
  });

  it("tiebreakRowIndex_bo7ThreeAllAfterSevenMaps_returnsSeven", () => {
    const maps = [map(1, 0), map(0, 1), map(1, 0), map(0, 1), map(1, 0), map(0, 1), map(2, 2), map(1, 0)];
    expect(tiebreakRowIndex(BO7, maps, "Ilios")).toBe(7);
  });

  it("tiebreakRowIndex_ft3TwoAllAfterFiveMaps_returnsFive", () => {
    const maps = [map(1, 0), map(0, 1), map(2, 2), map(1, 0), map(0, 1), map(0, 1)];
    expect(tiebreakRowIndex(FT3, maps, "Ilios")).toBe(5);
  });

  it("tiebreakRowIndex_bo5WithDraws_returnsNull", () => {
    const maps = [map(1, 0), map(0, 1), map(2, 2), map(1, 0), map(0, 1), map(1, 0)];
    expect(tiebreakRowIndex(BO5_DRAWS, maps, "Ilios")).toBeNull();
  });

  it("tiebreakRowIndex_bo5NoTiebreakMap_returnsNull", () => {
    const maps = [map(1, 0), map(0, 1), map(2, 2), map(1, 0), map(0, 1), map(1, 0)];
    expect(tiebreakRowIndex(BO5, maps, null)).toBeNull();
  });

  it("tiebreakRowIndex_freeScore_returnsNull", () => {
    const maps = [map(1, 0), map(0, 1), map(2, 2), map(1, 0), map(0, 1), map(1, 0)];
    expect(tiebreakRowIndex(null, maps, "Ilios")).toBeNull();
  });
});

describe("roundAllowsTiebreak — tous formats", () => {
  it("roundAllowsTiebreak_bgSurviePlayoffBo5DrawsNoPlayoffFormat_returnsTrue", () => {
    const survie = tournament({ format: "BG_SURVIE", matchFormat: BO5_DRAWS });
    expect(roundAllowsTiebreak(survie, PLAYOFF_1)).toBe(true);
  });

  it("roundAllowsTiebreak_bgSurvieQualificationBo5Draws_returnsFalse", () => {
    const survie = tournament({ format: "BG_SURVIE", matchFormat: BO5_DRAWS });
    expect(roundAllowsTiebreak(survie, UPPER_1)).toBe(false);
  });

  it("roundAllowsTiebreak_singleBo7_returnsTrue", () => {
    expect(roundAllowsTiebreak(tournament({ matchFormat: BO7 }), UPPER_1)).toBe(true);
  });

  it("roundAllowsTiebreak_survivalBo5_returnsFalse", () => {
    expect(roundAllowsTiebreak(tournament({ format: "SURVIVAL", matchFormat: BO5 }), UPPER_1)).toBe(false);
  });
});

describe("tiebreakTournamentFromRow", () => {
  it("tiebreakTournamentFromRow_columns_parsesFormatsAndDraws", () => {
    const actual = tiebreakTournamentFromRow(
      {
        format: "BG_SURVIE",
        match_format_type: "BO",
        match_format_value: 5,
        match_format_max_maps: null,
        match_format_draws: 1,
        endurance_playoff_format_type: "FT",
        endurance_playoff_format_value: 3,
      },
      null,
    );

    expect(actual).toEqual({
      format: "BG_SURVIE",
      matchFormat: { type: "BO", value: 5, drawsAllowed: true },
      endurancePlayoffFormat: { type: "FT", value: 3 },
      phases: null,
    });
  });

  it("tiebreakTournamentFromRow_missingColumns_returnsNullFormats", () => {
    const phases: TiebreakTournament["phases"] = [{ id: 6, format: "SINGLE" }];

    const actual = tiebreakTournamentFromRow({ format: "MULTI" }, phases);

    expect(actual).toEqual({ format: "MULTI", matchFormat: null, endurancePlayoffFormat: null, phases });
  });
});

describe("checkMapList — map de départage en BO 5", () => {
  const regular = [
    coded("AAAAA1", 1, 0),
    coded("AAAAA2", 0, 1),
    coded("AAAAA3", 2, 2),
    coded("AAAAA4", 1, 0),
    coded("AAAAA5", 0, 1),
  ];

  it("checkMapList_bo5PlayoffTiebreakRowDecides_acceptsThreeTwo", () => {
    const actual = checkMapList(BO5, "OW", [...regular, coded("AAAAA6", 3, 1)], { decisive: true });

    expect(actual.error).toBeNull();
    expect(actual.score).toEqual({ team1: 3, team2: 2, drawnMaps: 1 });
  });

  it("checkMapList_bo5TiebreakRowDrawn_refusesBelowFormat", () => {
    const actual = checkMapList(BO5, "OW", [...regular, coded("AAAAA6", 1, 1)], { decisive: true });

    expect(actual.error).toBe("SCORE_BELOW_MATCH_FORMAT");
  });

  it("checkMapList_bo5RowAfterTiebreakWin_refusesMapAfterDecision", () => {
    const maps = [...regular, coded("AAAAA6", 3, 1), coded("AAAAA7", 1, 0)];

    const actual = checkMapList(BO5, "OW", maps, { decisive: true });

    expect(actual.error).toBe("MAP_AFTER_DECISION");
  });
});
