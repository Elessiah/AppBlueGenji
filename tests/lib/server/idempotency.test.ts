import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  IDEMPOTENCY_TTL_MS,
  readRequestKey,
  resetIdempotencyForTests,
  runOnce,
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
