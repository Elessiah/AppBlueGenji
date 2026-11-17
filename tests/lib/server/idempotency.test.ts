import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  IDEMPOTENCY_MAX_ENTRIES,
  IDEMPOTENCY_MAX_PER_SCOPE,
  IDEMPOTENCY_TTL_MS,
  FINGERPRINT_MAX_DEPTH,
  bodyFingerprint,
  readRequestKey,
  idempotencyEntryCountForTests,
  resetIdempotencyForTests,
  runOnce,
  runOnceForBody,
} from "@/lib/server/idempotency";
import { newRequestKey } from "@/lib/shared/request-key";
import { isAdvanceTarget } from "@/lib/shared/tournament-launch";

/** Rejeu sans double effet (`lib/server/idempotency.ts`, EF-67 revue de sécurité). */
const KEY = "0123456789abcdef-key";
const NOW = 1_000_000;

describe("runOnce", () => {
  beforeEach(() => {
    resetIdempotencyForTests();
  });

  it("runOnce_noKey_runsTaskEveryTime", async () => {
    const task = jest.fn(async () => 1);
    await runOnce("scope", null, task, NOW);
    await runOnce("scope", null, task, NOW);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("runOnce_sameKey_returnsFirstResultWithoutRerun", async () => {
    const task = jest.fn(async () => 42);
    const first = await runOnce("scope", KEY, task, NOW);
    const second = await runOnce("scope", KEY, task, NOW + 1);
    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runOnce_concurrentSameKey_secondAwaitsFirst", async () => {
    let resolve: (value: number) => void = jest.fn<(value: number) => void>();
    const task = jest.fn(
      () =>
        new Promise<number>((r) => {
          resolve = r;
        }),
    );
    const first = runOnce("scope", KEY, task, NOW);
    const second = runOnce("scope", KEY, task, NOW);
    resolve(7);
    expect(await first).toBe(7);
    expect(await second).toBe(7);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runOnce_failedTask_isNotRetained", async () => {
    const failing = jest.fn(async (): Promise<number> => {
      throw new Error("BOOM");
    });
    await expect(runOnce("scope", KEY, failing, NOW)).rejects.toThrow("BOOM");
    const retry = jest.fn(async () => 3);
    expect(await runOnce("scope", KEY, retry, NOW + 1)).toBe(3);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("runOnce_otherScope_runsAgain", async () => {
    const task = jest.fn(async () => 1);
    await runOnce("tournament-create:1", KEY, task, NOW);
    await runOnce("tournament-create:2", KEY, task, NOW);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("runOnce_expiredEntry_runsAgain", async () => {
    const task = jest.fn(async () => 1);
    await runOnce("scope", KEY, task, NOW);
    await runOnce("scope", KEY, task, NOW + IDEMPOTENCY_TTL_MS);
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe("runOnce bounds and body fingerprint", () => {
  beforeEach(() => {
    resetIdempotencyForTests();
  });
  const keyOf = (n: number) => `key-${String(n).padStart(16, "0")}`;

  it("runOnce_scopeFull_evictsOwnOldestSettledOnly", async () => {
    const task = jest.fn(async () => 1);
    await runOnce("other", KEY, task, NOW);
    for (let n = 0; n < IDEMPOTENCY_MAX_PER_SCOPE + 1; n += 1) await runOnce("flood", keyOf(n), task, NOW);
    task.mockClear();
    await runOnce("other", KEY, task, NOW);
    expect(task).not.toHaveBeenCalled();
    await runOnce("flood", keyOf(0), task, NOW);
    expect(task).toHaveBeenCalledTimes(1);
    await runOnce("flood", keyOf(IDEMPOTENCY_MAX_PER_SCOPE), task, NOW);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runOnce_scopeFullOfPendingTasks_neverEvictsPendingAndRunsUnretained", async () => {
    const resolvers: Array<(value: number) => void> = [];
    const pending = () =>
      new Promise<number>((resolve) => {
        resolvers.push(resolve);
      });
    const first = runOnce("flood", keyOf(0), pending, NOW);
    for (let n = 1; n < IDEMPOTENCY_MAX_PER_SCOPE; n += 1) void runOnce("flood", keyOf(n), pending, NOW);
    const extra = jest.fn(async () => 9);
    expect(await runOnce("flood", keyOf(999), extra, NOW)).toBe(9);
    expect(await runOnce("flood", keyOf(999), extra, NOW)).toBe(9);
    expect(extra).toHaveBeenCalledTimes(2);
    const repeat = jest.fn(async () => 0);
    const second = runOnce("flood", keyOf(0), repeat, NOW);
    resolvers[0](5);
    expect(await first).toBe(5);
    expect(await second).toBe(5);
    expect(repeat).not.toHaveBeenCalled();
    resolvers.slice(1).forEach((resolve) => resolve(1));
  });

  it("runOnce_globalCapReached_evictsOldestSettledAcrossScopes", async () => {
    const task = jest.fn(async () => 1);
    const scopes = Math.ceil((IDEMPOTENCY_MAX_ENTRIES + 1) / IDEMPOTENCY_MAX_PER_SCOPE);
    for (let n = 0; n <= IDEMPOTENCY_MAX_ENTRIES; n += 1) {
      await runOnce(`scope-${n % scopes}`, keyOf(n), task, NOW);
    }
    task.mockClear();
    await runOnce("scope-0", keyOf(0), task, NOW);
    expect(task).toHaveBeenCalledTimes(1);
    await runOnce(`scope-${IDEMPOTENCY_MAX_ENTRIES % scopes}`, keyOf(IDEMPOTENCY_MAX_ENTRIES), task, NOW);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runOnce_sameKeyOtherFingerprint_runsAsNewGestureWithoutReplacingFirst", async () => {
    const first = jest.fn(async () => "first");
    const edited = jest.fn(async () => "edited");
    await runOnce("scope", KEY, first, NOW, "a");
    expect(await runOnce("scope", KEY, edited, NOW, "b")).toBe("edited");
    expect(await runOnce("scope", KEY, edited, NOW, "a")).toBe("first");
    expect(await runOnce("scope", KEY, edited, NOW, "b")).toBe("edited");
    expect(first).toHaveBeenCalledTimes(1);
    expect(edited).toHaveBeenCalledTimes(1);
  });

  it("runOnce_sameKeySameFingerprint_replays", async () => {
    const task = jest.fn(async () => 1);
    await runOnce("scope", KEY, task, NOW, "a");
    await runOnce("scope", KEY, task, NOW, "a");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("bodyFingerprint_requestKeyDiffers_sameFingerprint", () => {
    expect(bodyFingerprint({ name: "x", requestKey: "k1" })).toBe(bodyFingerprint({ name: "x", requestKey: "k2" }));
    expect(bodyFingerprint({ name: "x" })).not.toBe(bodyFingerprint({ name: "y" }));
  });

  it("runOnceForBody_editedRetryUnderOldKey_runsEditedBody", async () => {
    const task = jest.fn(async () => 1);
    await runOnceForBody("scope", { name: "a", requestKey: KEY }, task);
    await runOnceForBody("scope", { name: "a", requestKey: KEY }, task);
    expect(task).toHaveBeenCalledTimes(1);
    await runOnceForBody("scope", { name: "b", requestKey: KEY }, task);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("runOnceForBody_noKey_runsEveryTime", async () => {
    const task = jest.fn(async () => 1);
    await runOnceForBody("scope", { name: "a" }, task);
    await runOnceForBody("scope", { name: "a" }, task);
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe("runOnce security hardening (EF-68 security review)", () => {
  beforeEach(() => {
    resetIdempotencyForTests();
  });
  const keyOf = (n: number) => `key-${String(n).padStart(16, "0")}`;

  it("bodyFingerprint_fieldsInOtherOrder_sameFingerprint", () => {
    expect(bodyFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(bodyFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("bodyFingerprint_nestedRequestKeyDiffers_differentFingerprint", () => {
    expect(bodyFingerprint({ meta: { requestKey: "x" } })).not.toBe(bodyFingerprint({ meta: { requestKey: "y" } }));
  });

  it("bodyFingerprint_largeBody_fixedLengthHexDigest", () => {
    expect(bodyFingerprint({ pad: "x".repeat(200_000) })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("runOnce_nullFingerprintThenFingerprinted_runsAgain", async () => {
    const task = jest.fn(async () => 1);
    await runOnce("scope", KEY, task, NOW, null);
    await runOnce("scope", KEY, task, NOW, "a");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("runOnce_sameKeyOtherTarget_runsAgain", async () => {
    const task = jest.fn(async () => 1);
    await runOnce("scope", KEY, task, NOW, null, { target: "5:42" });
    await runOnce("scope", KEY, task, NOW, null, { target: "5:43" });
    await runOnce("scope", KEY, task, NOW, null, { target: "5:42" });
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("runOnce_manyTargets_shareOneScopeCap", async () => {
    const task = jest.fn(async () => 1);
    for (let n = 0; n < IDEMPOTENCY_MAX_PER_SCOPE + 50; n += 1) await runOnce("referee", keyOf(n), task, NOW, null, { target: `t${n}` });
    expect(idempotencyEntryCountForTests()).toBe(IDEMPOTENCY_MAX_PER_SCOPE);
  });

  it("runOnce_pendingPastTtl_expiresAndRunsAgain", async () => {
    const hung = jest.fn(() => new Promise<number>(() => undefined));
    void runOnce("scope", KEY, hung, NOW);
    const retry = jest.fn(async () => 2);
    expect(await runOnce("scope", KEY, retry, NOW + IDEMPOTENCY_TTL_MS)).toBe(2);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("runOnce_globalCap_evictsFromLargestScopeFirst", async () => {
    const task = jest.fn(async () => 1);
    await runOnce("quiet", KEY, task, NOW);
    const floodScopes = Math.ceil(IDEMPOTENCY_MAX_ENTRIES / IDEMPOTENCY_MAX_PER_SCOPE);
    for (let n = 0; n < IDEMPOTENCY_MAX_ENTRIES + 10; n += 1) {
      await runOnce(`flood-${n % floodScopes}`, keyOf(n), task, NOW);
    }
    task.mockClear();
    await runOnce("quiet", KEY, task, NOW);
    expect(task).not.toHaveBeenCalled();
    expect(idempotencyEntryCountForTests()).toBeLessThanOrEqual(IDEMPOTENCY_MAX_ENTRIES);
  });

  it("runOnce_freshReturnsCurrent_replaysCurrentWithoutRerun", async () => {
    const task = jest.fn(async () => ({ id: 7, name: "old" }));
    const fresh = jest.fn(async () => ({ id: 7, name: "new" }));
    await runOnce("scope", KEY, task, NOW, null, { fresh });
    expect(await runOnce("scope", KEY, task, NOW, null, { fresh })).toEqual({ id: 7, name: "new" });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runOnce_freshReturnsNull_runsTaskAgainAndRetainsNewResult", async () => {
    const task = jest.fn<() => Promise<{ id: number }>>().mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce({ id: 8 });
    const fresh = jest.fn<(cached: { id: number }) => Promise<{ id: number } | null>>().mockResolvedValueOnce(null);
    await runOnce("scope", KEY, task, NOW, null, { fresh });
    expect(await runOnce("scope", KEY, task, NOW, null, { fresh })).toEqual({ id: 8 });
    fresh.mockImplementation(async (cached) => cached);
    expect(await runOnce("scope", KEY, task, NOW, null, { fresh })).toEqual({ id: 8 });
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("runOnce_failedTask_entryCountRestored", async () => {
    await expect(
      runOnce("scope", KEY, async () => {
        throw new Error("BOOM");
      }, NOW),
    ).rejects.toThrow("BOOM");
    expect(idempotencyEntryCountForTests()).toBe(0);
  });
});

describe("readRequestKey", () => {
  it("readRequestKey_uuid_returnsKey", () => {
    expect(readRequestKey("123e4567-e89b-42d3-a456-426614174000")).toBe("123e4567-e89b-42d3-a456-426614174000");
  });
  it("readRequestKey_15chars_returnsNull", () => {
    expect(readRequestKey("a".repeat(15))).toBeNull();
  });
  it("readRequestKey_16chars_returnsKey", () => {
    expect(readRequestKey("a".repeat(16))).toBe("a".repeat(16));
  });
  it("readRequestKey_64chars_returnsKey", () => {
    expect(readRequestKey("a".repeat(64))).toBe("a".repeat(64));
  });
  it("readRequestKey_65chars_returnsNull", () => {
    expect(readRequestKey("a".repeat(65))).toBeNull();
  });
  it("readRequestKey_forbiddenCharacters_returnsNull", () => {
    expect(readRequestKey("aaaaaaaaaaaaaaaa:bb")).toBeNull();
  });
  it("readRequestKey_notString_returnsNull", () => {
    expect(readRequestKey(1234567890123456)).toBeNull();
  });
});

describe("newRequestKey", () => {
  it("newRequestKey_called_returnsKeyAcceptedByServer", () => {
    const key = newRequestKey();
    expect(readRequestKey(key)).toBe(key);
  });
  it("newRequestKey_calledTwice_returnsDistinctKeys", () => {
    expect(newRequestKey()).not.toBe(newRequestKey());
  });
  it("newRequestKey_withoutCrypto_timestampedKeysAcceptedAndDistinct", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    let first = "";
    let second = "";
    try {
      first = newRequestKey();
      second = newRequestKey();
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
    expect(readRequestKey(first)).toBe(first);
    expect(first).not.toBe(second);
  });

  it("newRequestKey_withoutRandomUUID_fallbackAcceptedByServer", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues: <T,>(array: T) => array },
    });
    let key = "";
    try {
      key = newRequestKey();
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
    expect(readRequestKey(key)).toBe(key);
  });
});

describe("isAdvanceTarget", () => {
  it("isAdvanceTarget_knownTargets_true", () => {
    expect(isAdvanceTarget("REGISTRATION")).toBe(true);
    expect(isAdvanceTarget("LOCKED")).toBe(true);
    expect(isAdvanceTarget("RUNNING")).toBe(true);
  });
  it("isAdvanceTarget_otherValues_false", () => {
    expect(isAdvanceTarget("HIDDEN")).toBe(false);
    expect(isAdvanceTarget(null)).toBe(false);
    expect(isAdvanceTarget(3)).toBe(false);
  });
});

/** Revue de sécurité EF-69 : empreinte sans prototype, profondeur bornée, échéance d'un geste recréé. */
describe("idempotency — revue de sécurité EF-69", () => {
  beforeEach(() => {
    resetIdempotencyForTests();
    jest.restoreAllMocks();
  });

  const nested = (depth: number): unknown => {
    let value: unknown = 1;
    for (let i = 0; i < depth; i += 1) value = [value];
    return value;
  };

  it("bodyFingerprint_protoKeyDiffers_differentFingerprint", () => {
    const a = JSON.parse('{"name":"x","__proto__":{"a":1}}') as object;
    const b = JSON.parse('{"name":"x","__proto__":{"a":2}}') as object;
    expect(bodyFingerprint(a)).not.toBe(bodyFingerprint(b));
  });

  it("bodyFingerprint_depthBelowCap_returnsDigest", () => {
    expect(bodyFingerprint({ deep: nested(FINGERPRINT_MAX_DEPTH - 2) })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("bodyFingerprint_depthOverCap_returnsNull", () => {
    expect(bodyFingerprint({ deep: nested(FINGERPRINT_MAX_DEPTH) })).toBeNull();
  });

  it("bodyFingerprint_veryDeepBody_returnsNullWithoutStackOverflow", () => {
    expect(bodyFingerprint({ deep: nested(200_000) })).toBeNull();
  });

  it("runOnceForBody_tooDeepBodyWithKey_runsEveryTimeWithoutReplay", async () => {
    const task = jest.fn(async () => 1);
    const body = { deep: nested(FINGERPRINT_MAX_DEPTH), requestKey: KEY };
    await runOnceForBody("scope", body, task);
    await runOnceForBody("scope", body, task);
    expect(task).toHaveBeenCalledTimes(2);
    expect(idempotencyEntryCountForTests()).toBe(0);
  });

  it("runOnce_rerunAfterFreshNull_expiryCountedFromRerun", async () => {
    const task = jest.fn<() => Promise<{ id: number }>>().mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce({ id: 8 });
    const fresh = jest.fn<(cached: { id: number }) => Promise<{ id: number } | null>>().mockResolvedValueOnce(null);
    const rerunAt = NOW + IDEMPOTENCY_TTL_MS - 1;
    await runOnce("scope", KEY, task, NOW, "a", { fresh });
    jest.spyOn(Date, "now").mockReturnValue(rerunAt);
    await runOnce("scope", KEY, task, rerunAt, "a", { fresh });
    fresh.mockImplementation(async (cached) => cached);

    const third = await runOnce("scope", KEY, task, NOW + IDEMPOTENCY_TTL_MS + 1, "a", { fresh });

    expect(third).toEqual({ id: 8 });
    expect(task).toHaveBeenCalledTimes(2);
  });
});
