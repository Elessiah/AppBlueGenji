import { describe, expect, it } from "@jest/globals";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { ROUND_MAP_SLOTS_MAX, type RoundKey } from "@/lib/shared/round-maps";
import { plannedRoundKeys, roundMaxMaps, type RoundPlanInput } from "@/lib/shared/round-plan";
import type { TournamentPhase } from "@/lib/shared/types";

/** Tours proposés par la fenêtre « Cartes et bans » (`docs/features/ROUND_MAPS.md`). */

function planInput(overrides: Partial<RoundPlanInput> = {}): RoundPlanInput {
  return {
    format: "SINGLE",
    state: "REGISTRATION",
    maxTeams: 8,
    registeredTeams: 3,
    hasThirdPlaceMatch: false,
    swissTotalRounds: null,
    enduranceMaxRounds: null,
    endurancePlayoffSize: null,
    phases: null,
    ...overrides,
  };
}

function phase(overrides: Partial<TournamentPhase> = {}): TournamentPhase {
  return {
    id: 11,
    position: 1,
    name: "Poules",
    format: "SWISS",
    qualifierMode: "COUNT",
    qualifierValue: 4,
    hasThirdPlaceMatch: false,
    swissTotalRounds: 3,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    state: "PENDING",
    entrants: null,
    qualifiers: null,
    maxRounds: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

const upper = (roundNumber: number, phaseId = 0): RoundKey => ({ phaseId, bracket: "UPPER", roundNumber });

describe("plannedRoundKeys", () => {
  it("plannedRoundKeys_singleBeforeStart_usesCapacity", () => {
    expect(plannedRoundKeys(planInput(), [], [])).toEqual([upper(1), upper(2), upper(3)]);
  });

  it("plannedRoundKeys_singleRunning_usesRegisteredTeams", () => {
    const input = planInput({ state: "RUNNING", registeredTeams: 4 });
    expect(plannedRoundKeys(input, [], [])).toEqual([upper(1), upper(2)]);
  });

  it("plannedRoundKeys_singleWithThirdPlace_addsThirdPlaceRound", () => {
    const keys = plannedRoundKeys(planInput({ hasThirdPlaceMatch: true }), [], []);
    expect(keys).toContainEqual({ phaseId: 0, bracket: "THIRD_PLACE", roundNumber: 1 });
  });

  it("plannedRoundKeys_singleUnderTwoEntrants_returnsEmpty", () => {
    const input = planInput({ state: "RUNNING", registeredTeams: 1 });
    expect(plannedRoundKeys(input, [], [])).toEqual([]);
  });

  it("plannedRoundKeys_doubleEightTeams_listsUpperLowerAndGrand", () => {
    const keys = plannedRoundKeys(planInput({ format: "DOUBLE" }), [], []);
    expect(keys.filter((key) => key.bracket === "UPPER")).toHaveLength(3);
    expect(keys.filter((key) => key.bracket === "LOWER")).toHaveLength(4);
    expect(keys.filter((key) => key.bracket === "GRAND")).toEqual([{ phaseId: 0, bracket: "GRAND", roundNumber: 1 }]);
  });

  it("plannedRoundKeys_doubleTwoTeams_hasNoLowerBracket", () => {
    const input = planInput({ format: "DOUBLE", state: "RUNNING", registeredTeams: 2 });
    const keys = plannedRoundKeys(input, [], []);
    expect(keys.filter((key) => key.bracket === "LOWER")).toEqual([]);
  });

  it("plannedRoundKeys_swiss_listsAnnouncedRounds", () => {
    const input = planInput({ format: "SWISS", swissTotalRounds: 4 });
    expect(plannedRoundKeys(input, [], [])).toEqual([upper(1), upper(2), upper(3), upper(4)]);
  });

  it("plannedRoundKeys_swissWithoutTotal_usesRecommendedRounds", () => {
    const input = planInput({ format: "SWISS", swissTotalRounds: null });
    expect(plannedRoundKeys(input, [], [])).toEqual([upper(1), upper(2), upper(3), upper(4)]);
  });

  it("plannedRoundKeys_swissTotalZero_usesRecommendedRounds", () => {
    const input = planInput({ format: "SWISS", swissTotalRounds: 0 });
    expect(plannedRoundKeys(input, [], [])).toHaveLength(4);
  });

  it("plannedRoundKeys_survival_offersGeneratedAndNextRound", () => {
    const input = planInput({ format: "SURVIVAL", state: "RUNNING" });
    expect(plannedRoundKeys(input, [upper(1), upper(2)], [])).toEqual([upper(1), upper(2), upper(3)]);
  });

  it("plannedRoundKeys_survivalBeforeAnyMatch_offersRoundOne", () => {
    expect(plannedRoundKeys(planInput({ format: "SURVIVAL" }), [], [])).toEqual([upper(1)]);
  });

  it("plannedRoundKeys_survivalFinished_offersNoNextRound", () => {
    const input = planInput({ format: "SURVIVAL", state: "FINISHED" });
    expect(plannedRoundKeys(input, [upper(1)], [])).toEqual([upper(1)]);
  });

  it("plannedRoundKeys_enduranceWithCapAndPlayoffs_listsQualifiersThenPlayoffs", () => {
    const input = planInput({ format: "BG_SURVIE", enduranceMaxRounds: 2, endurancePlayoffSize: 4 });
    const keys = plannedRoundKeys(input, [], []);
    expect(keys).toHaveLength(5);
    expect(keys).toEqual(
      expect.arrayContaining([
        upper(1),
        upper(2),
        upper(PLAYOFF_ROUND_OFFSET),
        upper(PLAYOFF_ROUND_OFFSET + 1),
        { phaseId: 0, bracket: "THIRD_PLACE", roundNumber: PLAYOFF_ROUND_OFFSET + 1 },
      ]),
    );
  });

  it("plannedRoundKeys_enduranceWithoutCap_offersNextQualifierRound", () => {
    const input = planInput({ format: "BG_SURVIE", state: "RUNNING" });
    expect(plannedRoundKeys(input, [upper(1)], [])).toEqual([upper(1), upper(2)]);
  });

  it("plannedRoundKeys_multiPhase_feedsQualifiersToNextPhase", () => {
    const phases = [phase({ qualifiers: 4 }), phase({ id: 12, position: 2, format: "SINGLE", swissTotalRounds: null })];
    const keys = plannedRoundKeys(planInput({ format: "MULTI", phases }), [], []);
    expect(keys).toHaveLength(5);
    expect(keys).toEqual(expect.arrayContaining([upper(1, 11), upper(2, 11), upper(3, 11), upper(1, 12), upper(2, 12)]));
  });

  it("plannedRoundKeys_configuredRoundOutsidePlan_staysListed", () => {
    expect(plannedRoundKeys(planInput(), [], [upper(7)])).toContainEqual(upper(7));
  });

  it("plannedRoundKeys_generatedRoundOutsidePlan_staysListed", () => {
    const input = planInput({ state: "RUNNING", registeredTeams: 2 });
    expect(plannedRoundKeys(input, [upper(2)], [])).toEqual([upper(1), upper(2)]);
  });

  it("plannedRoundKeys_absurdSwissCount_cappedAtFifty", () => {
    const input = planInput({ format: "SWISS", swissTotalRounds: 500 });
    expect(plannedRoundKeys(input, [], [])).toHaveLength(50);
  });
});

describe("roundMaxMaps", () => {
  const single = { format: "SINGLE" as const, endurancePlayoffFormat: null };

  it("roundMaxMaps_ft3_returnsFive", () => {
    expect(roundMaxMaps({ ...single, matchFormat: { type: "FT", value: 3 } }, 1)).toBe(5);
  });

  it("roundMaxMaps_freeScore_returnsNull", () => {
    expect(roundMaxMaps({ ...single, matchFormat: null }, 1)).toBeNull();
  });

  it("roundMaxMaps_longFormat_cappedAtSlotsMax", () => {
    expect(roundMaxMaps({ ...single, matchFormat: { type: "FT", value: 7 } }, 1)).toBe(ROUND_MAP_SLOTS_MAX);
  });

  it("roundMaxMaps_endurancePlayoffRound_readsPlayoffFormat", () => {
    const endurance = {
      format: "BG_SURVIE" as const,
      matchFormat: { type: "BO" as const, value: 1 },
      endurancePlayoffFormat: { type: "FT" as const, value: 2 },
    };
    expect(roundMaxMaps(endurance, 1)).toBe(1);
    expect(roundMaxMaps(endurance, PLAYOFF_ROUND_OFFSET)).toBe(3);
  });
});
