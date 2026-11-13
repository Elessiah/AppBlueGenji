import { describe, expect, it } from "@jest/globals";
import { canToggleMatchCheckIn, checkInSendable, readMatchCheckIn } from "@/lib/shared/match-check-in";

const due = new Date("2026-11-13T20:00:00Z");

describe("readMatchCheckIn", () => {
  it("readMatchCheckIn_absentColumns_enabledWithoutResume", () => {
    expect(readMatchCheckIn(undefined, undefined)).toEqual({ enabled: true, resumedAt: null });
  });

  it("readMatchCheckIn_nullFlag_enabled", () => {
    expect(readMatchCheckIn(null, null).enabled).toBe(true);
  });

  it("readMatchCheckIn_zeroFlag_disabled", () => {
    expect(readMatchCheckIn(0, null).enabled).toBe(false);
  });

  it("readMatchCheckIn_stringDate_parsed", () => {
    expect(readMatchCheckIn(1, "2026-11-13T19:00:00Z").resumedAt).toEqual(new Date("2026-11-13T19:00:00Z"));
  });

  it("readMatchCheckIn_unreadableDate_nullResume", () => {
    expect(readMatchCheckIn(1, "pas une date").resumedAt).toBeNull();
  });
});

describe("checkInSendable", () => {
  it("checkInSendable_disabled_false", () => {
    expect(checkInSendable({ enabled: false, resumedAt: null }, due)).toBe(false);
  });

  it("checkInSendable_enabledNeverResumed_true", () => {
    expect(checkInSendable({ enabled: true, resumedAt: null }, due)).toBe(true);
  });

  it("checkInSendable_resumedAfterDue_false", () => {
    expect(checkInSendable({ enabled: true, resumedAt: new Date("2026-11-13T20:00:01Z") }, due)).toBe(false);
  });

  it("checkInSendable_resumedExactlyAtDue_true", () => {
    expect(checkInSendable({ enabled: true, resumedAt: new Date("2026-11-13T20:00:00Z") }, due)).toBe(true);
  });
});

describe("canToggleMatchCheckIn", () => {
  it("canToggleMatchCheckIn_running_true", () => {
    expect(canToggleMatchCheckIn("RUNNING")).toBe(true);
  });

  it("canToggleMatchCheckIn_finished_false", () => {
    expect(canToggleMatchCheckIn("FINISHED")).toBe(false);
  });
});
