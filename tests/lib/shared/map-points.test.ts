import { describe, expect, it } from "@jest/globals";
import {
  singleMapDisplayScore,
  DEFAULT_MAP_POINT_TARGET,
  MAP_POINT_TARGET_MAX,
  MAP_POINT_TARGET_MIN,
  duelMapScoreFault,
  effectiveMapPointTarget,
  isValidMapPointTarget,
  mapPointsLine,
  parseStoredMapPointTarget,
  roundPointTargetOf,
} from "@/lib/shared/map-points";

/** Format Duel / Arcade (`docs/features/DUEL_ARCADE.md`) : règles pures. */

const ROUND = { phaseId: 0, bracket: "UPPER", roundNumber: 2 };

describe("isValidMapPointTarget", () => {
  it("isValidMapPointTarget_lowerBound_accepted", () => {
    expect(isValidMapPointTarget(MAP_POINT_TARGET_MIN)).toBe(true);
  });

  it("isValidMapPointTarget_upperBound_accepted", () => {
    expect(isValidMapPointTarget(MAP_POINT_TARGET_MAX)).toBe(true);
  });

  it("isValidMapPointTarget_zero_refused", () => {
    expect(isValidMapPointTarget(0)).toBe(false);
  });

  it("isValidMapPointTarget_hundred_refused", () => {
    expect(isValidMapPointTarget(100)).toBe(false);
  });

  it("isValidMapPointTarget_fraction_refused", () => {
    expect(isValidMapPointTarget(4.5)).toBe(false);
  });

  it("isValidMapPointTarget_numericString_refused", () => {
    expect(isValidMapPointTarget("5")).toBe(false);
  });

  it("defaultTarget_isFive", () => {
    expect(DEFAULT_MAP_POINT_TARGET).toBe(5);
  });
});

describe("parseStoredMapPointTarget", () => {
  it("parseStoredMapPointTarget_null_returnsNull", () => {
    expect(parseStoredMapPointTarget(null)).toBeNull();
  });

  it("parseStoredMapPointTarget_emptyString_returnsNull", () => {
    expect(parseStoredMapPointTarget("")).toBeNull();
  });

  it("parseStoredMapPointTarget_numericString_returnsNumber", () => {
    expect(parseStoredMapPointTarget("7")).toBe(7);
  });

  it("parseStoredMapPointTarget_outOfRange_returnsNull", () => {
    expect(parseStoredMapPointTarget(150)).toBeNull();
  });
});

describe("effectiveMapPointTarget", () => {
  it("effectiveMapPointTarget_tournamentOff_ignoresRoundOverride", () => {
    expect(effectiveMapPointTarget(null, [{ ...ROUND, target: 3 }], ROUND)).toBeNull();
  });

  it("effectiveMapPointTarget_roundOverride_wins", () => {
    expect(effectiveMapPointTarget(5, [{ ...ROUND, target: 3 }], ROUND)).toBe(3);
  });

  it("effectiveMapPointTarget_overrideOnOtherRound_returnsTournamentTarget", () => {
    expect(effectiveMapPointTarget(5, [{ ...ROUND, roundNumber: 3, target: 3 }], ROUND)).toBe(5);
  });

  it("roundPointTargetOf_noTargets_returnsNull", () => {
    expect(roundPointTargetOf(undefined, ROUND)).toBeNull();
  });
});

describe("duelMapScoreFault", () => {
  it("duelMapScoreFault_team1ReachesTarget_valid", () => {
    expect(duelMapScoreFault({ team1Score: 5, team2Score: 3 }, 5)).toBeNull();
  });

  it("duelMapScoreFault_team2ReachesTargetOnShutout_valid", () => {
    expect(duelMapScoreFault({ team1Score: 0, team2Score: 5 }, 5)).toBeNull();
  });

  it("duelMapScoreFault_loserOneBelowTarget_valid", () => {
    expect(duelMapScoreFault({ team1Score: 5, team2Score: 4 }, 5)).toBeNull();
  });

  it("duelMapScoreFault_tieAtTarget_flagsTeam2", () => {
    expect(duelMapScoreFault({ team1Score: 5, team2Score: 5 }, 5)).toBe("team2Score");
  });

  it("duelMapScoreFault_team1OverTarget_flagsTeam1", () => {
    expect(duelMapScoreFault({ team1Score: 6, team2Score: 3 }, 5)).toBe("team1Score");
  });

  it("duelMapScoreFault_team2OverTarget_flagsTeam2", () => {
    expect(duelMapScoreFault({ team1Score: 3, team2Score: 6 }, 5)).toBe("team2Score");
  });

  it("duelMapScoreFault_nobodyReachedTarget_flagsTheLowerSide", () => {
    expect(duelMapScoreFault({ team1Score: 4, team2Score: 2 }, 5)).toBe("team2Score");
  });
});

describe("mapPointsLine", () => {
  it("mapPointsLine_twoMaps_joinsWithEnDashAndMiddleDot", () => {
    expect(mapPointsLine([{ team1Score: 5, team2Score: 3 }, { team1Score: 2, team2Score: 5 }])).toBe(
      "5–3 · 2–5",
    );
  });

  it("mapPointsLine_noMap_returnsEmpty", () => {
    expect(mapPointsLine([])).toBe("");
  });
});

describe("singleMapDisplayScore", () => {
  const BO1 = { type: "BO", value: 1 } as const;
  const played = { team1Score: 1, team2Score: 0, forfeitTeamId: null, maps: [{ team1Score: 5, team2Score: 3 }] };

  it("singleMapDisplayScore_bo1WithOneMap_returnsTheMapScore", () => {
    expect(singleMapDisplayScore(played, BO1)).toEqual({ team1: 5, team2: 3 });
  });

  it("singleMapDisplayScore_ft1WithOneMap_returnsTheMapScore", () => {
    expect(singleMapDisplayScore(played, { type: "FT", value: 1 })).toEqual({ team1: 5, team2: 3 });
  });

  it("singleMapDisplayScore_bo3_returnsNull", () => {
    expect(singleMapDisplayScore(played, { type: "BO", value: 3 })).toBeNull();
  });

  it("singleMapDisplayScore_freeFormat_returnsNull", () => {
    expect(singleMapDisplayScore(played, null)).toBeNull();
  });

  it("singleMapDisplayScore_noMapRecorded_returnsNull", () => {
    expect(singleMapDisplayScore({ ...played, maps: [] }, BO1)).toBeNull();
  });

  it("singleMapDisplayScore_drawnMapReplayed_returnsNull", () => {
    const maps = [{ team1Score: 2, team2Score: 2 }, { team1Score: 3, team2Score: 1 }];

    expect(singleMapDisplayScore({ ...played, maps }, BO1)).toBeNull();
  });

  it("singleMapDisplayScore_forfeit_returnsNull", () => {
    expect(singleMapDisplayScore({ ...played, forfeitTeamId: 2 }, BO1)).toBeNull();
  });

  it("singleMapDisplayScore_noScorePosted_returnsNull", () => {
    expect(singleMapDisplayScore({ ...played, team1Score: null, team2Score: null }, BO1)).toBeNull();
  });
});
