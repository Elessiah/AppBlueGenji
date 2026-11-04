import { describe, expect, it } from "@jest/globals";
import { isoTime } from "@/lib/shared/iso-time";
import { castWithoutStartAt, type MatchLiveInput } from "@/lib/shared/live-streams";
import { shownMapName } from "@/lib/shared/round-maps";
import { CodedError, errorCode } from "@/lib/shared/field-errors";
import { mergeRefusals, settledRefusals, settledValue } from "@/lib/shared/settled-value";
import { launchPhaseBadgeKind } from "@/app/(secured)/tournois/[id]/_lib/launch-strip";

// Petites aides partagées par la page du match et sa carte (lot EF-36).

const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);

describe("isoTime", () => {
  it("isoTime_validIso_returnsMs", () => {
    expect(isoTime("2026-11-05T20:00:00.000Z")).toBe(Date.UTC(2026, 10, 5, 20));
  });

  it("isoTime_nullOrEmpty_returnsNull", () => {
    expect(isoTime(null)).toBeNull();
    expect(isoTime(undefined)).toBeNull();
    expect(isoTime("")).toBeNull();
  });

  it("isoTime_garbage_returnsNull", () => {
    expect(isoTime("demain")).toBeNull();
  });
});

describe("castWithoutStartAt", () => {
  const input = (overrides: Partial<MatchLiveInput> = {}): MatchLiveInput => ({
    status: "READY",
    liveTrigger: "START_TIME",
    liveStartedAt: null,
    startAt: null,
    launchedAt: null,
    ...overrides,
  });

  it("castWithoutStartAt_startTimeNoDate_true", () => {
    expect(castWithoutStartAt(input())).toBe(true);
  });

  it("castWithoutStartAt_dated_false", () => {
    expect(castWithoutStartAt(input({ startAt: "2026-11-05T20:00:00.000Z" }))).toBe(false);
  });

  it("castWithoutStartAt_manualTrigger_false", () => {
    expect(castWithoutStartAt(input({ liveTrigger: "MANUAL" }))).toBe(false);
  });

  it("castWithoutStartAt_completed_false", () => {
    expect(castWithoutStartAt(input({ status: "COMPLETED" }))).toBe(false);
  });
});

describe("shownMapName", () => {
  it("shownMapName_plainName_kept", () => {
    expect(shownMapName("Ilios")).toBe("Ilios");
  });

  it("shownMapName_invisibleOnly_null", () => {
    expect(shownMapName(` ${RIGHT_TO_LEFT_OVERRIDE} `)).toBeNull();
  });

  it("shownMapName_null_null", () => {
    expect(shownMapName(null)).toBeNull();
  });

  it("shownMapName_paddedWithControl_trimmedAndCleaned", () => {
    expect(shownMapName(`  Tok${RIGHT_TO_LEFT_OVERRIDE}yo `)).toBe("Tokyo");
  });
});

describe("settledValue", () => {
  it("settledValue_notSent_fallback", () => {
    expect(settledValue(null, false)).toBe(false);
  });

  it("settledValue_fulfilled_value", () => {
    expect(settledValue({ status: "fulfilled", value: true }, false)).toBe(true);
  });

  it("settledValue_rejected_fallbackNotThrow", () => {
    const reason = new Error("TOURNAMENT_FINISHED");

    expect(settledValue({ status: "rejected", reason }, false)).toBe(false);
  });
});

describe("settledRefusals", () => {
  const refused = (message: string): PromiseSettledResult<boolean> => ({ status: "rejected", reason: new CodedError(message, message) });

  it("settledRefusals_allFulfilledOrNotSent_empty", () => {
    expect(settledRefusals(null, { status: "fulfilled", value: true })).toEqual([]);
    expect(settledRefusals()).toEqual([]);
  });

  it("settledRefusals_oneRefused_itsReasonOnly", () => {
    const refusals = settledRefusals({ status: "fulfilled", value: true }, refused("VOICE"));

    expect(refusals).toHaveLength(1);
    expect(errorCode(refusals[0])).toBe("VOICE");
  });

  it("settledRefusals_bothRefused_keepsSendOrder", () => {
    expect(settledRefusals(refused("PLANNING"), refused("VOICE")).map(errorCode)).toEqual(["PLANNING", "VOICE"]);
  });
});

describe("mergeRefusals", () => {
  it("mergeRefusals_single_returnedAsIs", () => {
    const reason = new CodedError("VOICE", "Salons refusés.");

    expect(mergeRefusals([reason])).toBe(reason);
  });

  it("mergeRefusals_several_sayEveryRefusalWithFirstCode", () => {
    const merged = mergeRefusals([new CodedError("PLANNING", "Planification refusée."), new CodedError("VOICE", "Salons refusés.")]);

    expect((merged as Error).message).toBe("Planification refusée. Salons refusés.");
    expect(errorCode(merged)).toBe("PLANNING");
  });

  it("mergeRefusals_plainErrorsWithoutMessage_skipsEmptyAndUsesUnknownCode", () => {
    const merged = mergeRefusals(["boom", new Error("Réseau.")]);

    expect((merged as Error).message).toBe("Réseau.");
    expect(errorCode(merged)).toBe("UNKNOWN");
  });

  it("mergeRefusals_noReadableMessage_firstRefusalNotBlankToast", () => {
    const first = { status: 409 };

    expect(mergeRefusals([first, "boom"])).toBe(first);
  });

  it("mergeRefusals_noRefusal_undefined", () => {
    expect(mergeRefusals([])).toBeUndefined();
  });
});

describe("launchPhaseBadgeKind", () => {
  it("launchPhaseBadgeKind_beforeLaunch_returnsPhase", () => {
    expect(launchPhaseBadgeKind({ status: "READY" }, "TO_PLAN")).toBe("TO_PLAN");
    expect(launchPhaseBadgeKind({ status: "READY" }, "SCHEDULED")).toBe("SCHEDULED");
    expect(launchPhaseBadgeKind({ status: "READY" }, "LOBBY")).toBe("LOBBY");
  });

  it("launchPhaseBadgeKind_launchedReady_launched", () => {
    expect(launchPhaseBadgeKind({ status: "READY" }, "LAUNCHED")).toBe("LAUNCHED");
  });

  it("launchPhaseBadgeKind_launchedButScored_null", () => {
    expect(launchPhaseBadgeKind({ status: "AWAITING_CONFIRMATION" }, "LAUNCHED")).toBeNull();
  });
});
