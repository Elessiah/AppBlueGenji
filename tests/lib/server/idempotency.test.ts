import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  IDEMPOTENCY_MAX_ENTRIES,
  IDEMPOTENCY_MAX_PER_SCOPE,
  IDEMPOTENCY_TTL_MS,
  bodyFingerprint,
  readRequestKey,
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
