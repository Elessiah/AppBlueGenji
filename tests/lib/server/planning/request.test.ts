import { describe, expect, it, jest } from "@jest/globals";
import { PLANNING_CONFIRM_MAX_KEYS, readConfirmScope, readInstant, readWindow } from "@/lib/server/planning/request";
import { planningFailure, readEntryKey } from "@/lib/server/planning/routes";
import { CONCURRENT_UPDATE_RETRY } from "@/lib/shared/api-error-code";

/** Lecture des corps des gestes de lot et traduction des refus du planning (`CAST_PLANNING.md`). */

const FROM = "2026-11-23T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("readInstant", () => {
  it("readInstant_iso_returnsTime", () => {
    expect(readInstant(FROM)).toBe(Date.parse(FROM));
  });

  it("readInstant_garbage_returnsNull", () => {
    expect(readInstant("demain")).toBeNull();
  });

  it("readInstant_over40Chars_returnsNull", () => {
    expect(readInstant(`${FROM}${" ".repeat(20)}`)).toBeNull();
  });

  it("readInstant_nonString_returnsNull", () => {
    expect(readInstant(Date.parse(FROM))).toBeNull();
  });
});

describe("readWindow", () => {
  const start = Date.parse(FROM);

  it("readWindow_31Days_returnsWindow", () => {
    expect(readWindow({ from: FROM, to: iso(start + 31 * DAY_MS) })).toEqual({ from: start, to: start + 31 * DAY_MS });
  });

  it("readWindow_31DaysPlus1ms_returnsNull", () => {
    expect(readWindow({ from: FROM, to: iso(start + 31 * DAY_MS + 1) })).toBeNull();
  });

  it("readWindow_toEqualsFrom_returnsNull", () => {
    expect(readWindow({ from: FROM, to: FROM })).toBeNull();
  });

  it("readWindow_missingFrom_returnsNull", () => {
    expect(readWindow({ to: FROM })).toBeNull();
  });
});

describe("readConfirmScope", () => {
  it("readConfirmScope_keys_dedupedNormalized", () => {
    expect(readConfirmScope({ entryKeys: ["m:4", "m:4", "t:2"] })).toEqual({ entryKeys: ["m:4", "t:2"] });
  });

  it("readConfirmScope_untilOnly_returnsUntil", () => {
    expect(readConfirmScope({ until: FROM })).toEqual({ entryKeys: [], until: Date.parse(FROM) });
  });

  it("readConfirmScope_empty_returnsNull", () => {
    expect(readConfirmScope({})).toBeNull();
  });

  it("readConfirmScope_maxKeys_accepted", () => {
    const keys = Array.from({ length: PLANNING_CONFIRM_MAX_KEYS }, (_, index) => `m:${index + 1}`);
    expect(readConfirmScope({ entryKeys: keys })?.entryKeys).toHaveLength(PLANNING_CONFIRM_MAX_KEYS);
  });

  it("readConfirmScope_overMaxKeys_returnsNull", () => {
    const keys = Array.from({ length: PLANNING_CONFIRM_MAX_KEYS + 1 }, (_, index) => `m:${index + 1}`);
    expect(readConfirmScope({ entryKeys: keys })).toBeNull();
  });

  it("readConfirmScope_badKey_returnsNull", () => {
    expect(readConfirmScope({ entryKeys: ["m:4", "z:1"] })).toBeNull();
  });

  it("readConfirmScope_badUntil_returnsNull", () => {
    expect(readConfirmScope({ entryKeys: ["m:4"], until: "jamais" })).toBeNull();
  });

  it("readConfirmScope_notArray_returnsNull", () => {
    expect(readConfirmScope({ entryKeys: "m:4" })).toBeNull();
  });
});

describe("readEntryKey / planningFailure", () => {
  it("readEntryKey_valid_returnsKey", () => {
    expect(readEntryKey("t:12")).toBe("t:12");
  });

  it("readEntryKey_invalid_returnsNull", () => {
    expect(readEntryKey("t:abc")).toBeNull();
  });

  it("planningFailure_knownCode_returnsMappedStatus", async () => {
    const response = planningFailure(new Error("PLANNING_ENTRY_NOT_FOUND"), "PLANNING_LOAD_FAILED");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "PLANNING_ENTRY_NOT_FOUND" });
  });

  it("planningFailure_busy_returns409", () => {
    expect(planningFailure(new Error("PLANNING_BUSY"), "PLANNING_LOAD_FAILED").status).toBe(409);
  });

  it("planningFailure_contention_returns409Retry", async () => {
    const deadlock = Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    const response = planningFailure(deadlock, "PLANNING_LOAD_FAILED");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: CONCURRENT_UPDATE_RETRY });
  });

  it("planningFailure_unknown_returns500Fallback", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const response = planningFailure(new Error("boom"), "PLANNING_LOAD_FAILED");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "PLANNING_LOAD_FAILED" });
    log.mockRestore();
  });
});
