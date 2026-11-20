import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { startPeriodicClock, stopAllPeriodicClocks, stopPeriodicClock, type PeriodicClockOptions } from "@/lib/server/periodic-clock";

/** Horloges de fond communes (`docs/features/SCHEDULE_DEADLINE.md`). */

const FIRST_MS = 1_000;
const TICK_MS = 5_000;

function clock(run: () => Promise<unknown>, key = "test-clock"): PeriodicClockOptions {
  return { key, firstDelayMs: FIRST_MS, tickMs: TICK_MS, run, failureMessage: "[test] Passage impossible." };
}

let errorSpy: jest.SpiedFunction<typeof console.error>;

beforeEach(() => {
  jest.useFakeTimers();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await stopAllPeriodicClocks();
  delete (globalThis as typeof globalThis & { __bgPeriodicClocks?: unknown }).__bgPeriodicClocks;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("startPeriodicClock", () => {
  it("startPeriodicClock_beforeFirstDelay_doesNotRun", async () => {
    const run = jest.fn(async () => undefined);
    startPeriodicClock(clock(run));

    await jest.advanceTimersByTimeAsync(FIRST_MS - 1);

    expect(run).not.toHaveBeenCalled();
  });

  it("startPeriodicClock_afterFirstDelay_runsOnce", async () => {
    const run = jest.fn(async () => undefined);
    startPeriodicClock(clock(run));

    await jest.advanceTimersByTimeAsync(FIRST_MS);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("startPeriodicClock_eachTick_runsAgain", async () => {
    const run = jest.fn(async () => undefined);
    startPeriodicClock(clock(run));

    await jest.advanceTimersByTimeAsync(FIRST_MS + TICK_MS * 2);

    // Premier passage à 1 s, puis un par intervalle compté de là (6 s, 11 s).
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("startPeriodicClock_firstDelayLongerThanTick_noPassBeforeFirstDelay", async () => {
    const run = jest.fn(async () => undefined);
    startPeriodicClock({ ...clock(run), firstDelayMs: TICK_MS * 2 });

    await jest.advanceTimersByTimeAsync(TICK_MS * 2 - 1);

    expect(run).not.toHaveBeenCalled();
  });

  it("startPeriodicClock_calledTwice_armsOneClock", async () => {
    const run = jest.fn(async () => undefined);

    startPeriodicClock(clock(run));
    startPeriodicClock(clock(run));
    await jest.advanceTimersByTimeAsync(FIRST_MS);
    startPeriodicClock(clock(run));

    expect(jest.getTimerCount()).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("startPeriodicClock_passStillRunning_skipsOverlappingTick", async () => {
    let release: () => void = () => undefined;
    const run = jest.fn(() => new Promise<void>((resolve) => (release = resolve)));
    startPeriodicClock(clock(run));

    await jest.advanceTimersByTimeAsync(FIRST_MS + TICK_MS * 2);

    expect(run).toHaveBeenCalledTimes(1);
    release();
  });

  it("startPeriodicClock_repeatedFailures_logsOncePerOutage", async () => {
    const run = jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new TypeError("a"))
      .mockRejectedValueOnce(new TypeError("b"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError("c"));
    startPeriodicClock(clock(run));

    await jest.advanceTimersByTimeAsync(FIRST_MS + TICK_MS);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(TICK_MS * 2);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenLastCalledWith("[test] Passage impossible.", "TypeError");
  });
});

describe("stopPeriodicClock", () => {
  it("stopPeriodicClock_unknownKey_resolves", async () => {
    await expect(stopPeriodicClock("absent")).resolves.toBeUndefined();
  });

  it("stopPeriodicClock_beforeFirstPass_clearsBothTimers", async () => {
    const run = jest.fn(async () => undefined);
    startPeriodicClock(clock(run));

    await stopPeriodicClock("test-clock");
    await jest.advanceTimersByTimeAsync(TICK_MS * 2);

    expect(jest.getTimerCount()).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("stopPeriodicClock_passInFlight_waitsForIt", async () => {
    let release: () => void = () => undefined;
    const run = jest.fn(() => new Promise<void>((resolve) => (release = resolve)));
    startPeriodicClock(clock(run));
    await jest.advanceTimersByTimeAsync(FIRST_MS);
    const stopped = jest.fn();

    const stopping = stopPeriodicClock("test-clock").then(stopped);
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    release();
    await stopping;

    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it("stopPeriodicClock_calledTwice_staysStopped", async () => {
    startPeriodicClock(clock(jest.fn(async () => undefined)));

    await stopPeriodicClock("test-clock");
    await stopPeriodicClock("test-clock");

    expect(jest.getTimerCount()).toBe(0);
  });

  it("stopPeriodicClock_afterStop_canRestart", async () => {
    const run = jest.fn(async () => undefined);
    startPeriodicClock(clock(run));
    await stopPeriodicClock("test-clock");

    startPeriodicClock(clock(run));
    await jest.advanceTimersByTimeAsync(FIRST_MS);

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("stopAllPeriodicClocks", () => {
  it("stopAllPeriodicClocks_twoClocks_clearsAllSynchronously", async () => {
    startPeriodicClock(clock(jest.fn(async () => undefined), "a"));
    await jest.advanceTimersByTimeAsync(FIRST_MS);
    startPeriodicClock(clock(jest.fn(async () => undefined), "b"));

    void stopAllPeriodicClocks();

    expect(jest.getTimerCount()).toBe(0);
  });
});
