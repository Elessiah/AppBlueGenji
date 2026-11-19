import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_PLANNING_DURATIONS,
  estimateEventMinutes,
  estimateMatchMinutes,
  maxMapsOf,
  parseDurationSettings,
  validateDurationSettings,
  type MatchFormatForDuration,
  type PlanningDurationSettings,
} from "@/lib/shared/planning-durations";

/** Durées estimées du planning (`docs/features/CAST_PLANNING.md` § Calcul). */

const SETTINGS: PlanningDurationSettings = { mapMinutes: { OW: 15, MR: 12 }, bufferMinutes: 10, defaultMaps: 3, eventHours: 4, confirmLeadHours: 24 };

function format(overrides: Partial<MatchFormatForDuration> = {}): MatchFormatForDuration {
  return { game: "OW", type: null, value: null, maxMaps: null, ...overrides };
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { mapMinutes: { OW: 15, MR: 12 }, bufferMinutes: 10, defaultMaps: 3, eventHours: 4, ...overrides };
}

describe("maxMapsOf / estimateMatchMinutes / estimateEventMinutes", () => {
  it("maxMapsOf_BO5_returns5", () => {
    expect(maxMapsOf(format({ type: "BO", value: 5 }), SETTINGS)).toBe(5);
  });

  it("maxMapsOf_FT3WithMaxMaps_returnsMaxMaps", () => {
    expect(maxMapsOf(format({ type: "FT", value: 3, maxMaps: 4 }), SETTINGS)).toBe(4);
  });

  it("maxMapsOf_FT3WithoutMax_returns5", () => {
    expect(maxMapsOf(format({ type: "FT", value: 3 }), SETTINGS)).toBe(5);
  });

  it("maxMapsOf_noFormat_returnsDefaultMaps", () => {
    expect(maxMapsOf(format(), SETTINGS)).toBe(3);
  });

  it("maxMapsOf_zeroValue_returnsDefaultMaps", () => {
    expect(maxMapsOf(format({ type: "BO", value: 0 }), SETTINGS)).toBe(3);
  });

  it("estimateMatchMinutes_OWBO3_mapsTimesMinutesPlusBuffer", () => {
    expect(estimateMatchMinutes(format({ type: "BO", value: 3 }), SETTINGS)).toBe(55);
  });

  it("estimateMatchMinutes_MR_usesMRMinutes", () => {
    expect(estimateMatchMinutes(format({ game: "MR", type: "BO", value: 3 }), SETTINGS)).toBe(46);
  });

  it("estimateEventMinutes_returnsHoursTimes60", () => {
    expect(estimateEventMinutes(SETTINGS)).toBe(240);
  });
});

describe("validateDurationSettings", () => {
  it("validateDurationSettings_allBoundsMin_returnsSettings", () => {
    const min = { mapMinutes: { OW: 5, MR: 5 }, bufferMinutes: 0, defaultMaps: 1, eventHours: 1, confirmLeadHours: 24 };
    expect(validateDurationSettings(min)).toEqual(min);
  });

  it("validateDurationSettings_allBoundsMax_returnsSettings", () => {
    const max = { mapMinutes: { OW: 60, MR: 60 }, bufferMinutes: 60, defaultMaps: 9, eventHours: 12, confirmLeadHours: 168 };
    expect(validateDurationSettings(max)).toEqual(max);
  });

  it("validateDurationSettings_owMinutesBelowMin_returnsNull", () => {
    expect(validateDurationSettings(body({ mapMinutes: { OW: 4, MR: 12 } }))).toBeNull();
  });

  it("validateDurationSettings_owMinutesAboveMax_returnsNull", () => {
    expect(validateDurationSettings(body({ mapMinutes: { OW: 61, MR: 12 } }))).toBeNull();
  });

  it("validateDurationSettings_mrMinutesBelowMin_returnsNull", () => {
    expect(validateDurationSettings(body({ mapMinutes: { OW: 15, MR: 4 } }))).toBeNull();
  });

  it("validateDurationSettings_mrMinutesAboveMax_returnsNull", () => {
    expect(validateDurationSettings(body({ mapMinutes: { OW: 15, MR: 61 } }))).toBeNull();
  });

  it("validateDurationSettings_bufferNegative_returnsNull", () => {
    expect(validateDurationSettings(body({ bufferMinutes: -1 }))).toBeNull();
  });

  it("validateDurationSettings_bufferAboveMax_returnsNull", () => {
    expect(validateDurationSettings(body({ bufferMinutes: 61 }))).toBeNull();
  });

  it("validateDurationSettings_defaultMapsZero_returnsNull", () => {
    expect(validateDurationSettings(body({ defaultMaps: 0 }))).toBeNull();
  });

  it("validateDurationSettings_defaultMapsAboveMax_returnsNull", () => {
    expect(validateDurationSettings(body({ defaultMaps: 10 }))).toBeNull();
  });

  it("validateDurationSettings_eventHoursZero_returnsNull", () => {
    expect(validateDurationSettings(body({ eventHours: 0 }))).toBeNull();
  });

  it("validateDurationSettings_eventHoursAboveMax_returnsNull", () => {
    expect(validateDurationSettings(body({ eventHours: 13 }))).toBeNull();
  });

  it("validateDurationSettings_nonInteger_returnsNull", () => {
    expect(validateDurationSettings(body({ bufferMinutes: 12.5 }))).toBeNull();
  });

  it("validateDurationSettings_missingMapMinutes_returnsNull", () => {
    expect(validateDurationSettings(body({ mapMinutes: undefined }))).toBeNull();
  });

  it("validateDurationSettings_nonObject_returnsNull", () => {
    expect(validateDurationSettings("15")).toBeNull();
  });

  it("validateDurationSettings_confirmLeadMissing_defaultsTo24", () => {
    expect(validateDurationSettings(body())?.confirmLeadHours).toBe(24);
  });

  it("validateDurationSettings_confirmLeadBelow24_returnsNull", () => {
    expect(validateDurationSettings(body({ confirmLeadHours: 23 }))).toBeNull();
  });

  it("validateDurationSettings_confirmLead168_keepsIt", () => {
    expect(validateDurationSettings(body({ confirmLeadHours: 168 }))?.confirmLeadHours).toBe(168);
  });

  it("validateDurationSettings_confirmLeadAbove168_returnsNull", () => {
    expect(validateDurationSettings(body({ confirmLeadHours: 169 }))).toBeNull();
  });
});

describe("parseDurationSettings", () => {
  it("parseDurationSettings_null_returnsDefault", () => {
    expect(parseDurationSettings(null)).toEqual(DEFAULT_PLANNING_DURATIONS);
  });

  it("parseDurationSettings_invalidJson_returnsDefault", () => {
    expect(parseDurationSettings("{oops")).toEqual(DEFAULT_PLANNING_DURATIONS);
  });

  it("parseDurationSettings_outOfBounds_returnsDefault", () => {
    expect(parseDurationSettings(JSON.stringify(body({ eventHours: 40 })))).toEqual(DEFAULT_PLANNING_DURATIONS);
  });

  it("parseDurationSettings_valid_returnsParsed", () => {
    expect(parseDurationSettings(JSON.stringify(body({ eventHours: 6 })))).toEqual({ ...SETTINGS, eventHours: 6 });
  });
});
