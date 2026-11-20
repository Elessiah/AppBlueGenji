import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { resumeSuspendedPeriodicClocks, startPeriodicClock, stopAllPeriodicClocks, stopPeriodicClock, type PeriodicClockOptions } from "@/lib/server/periodic-clock";

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

  it("startPeriodicClock_passHangs_warnsOnceAboutSkippedTicks", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    let release: () => void = () => undefined;
    startPeriodicClock(clock(() => new Promise<void>((resolve) => (release = resolve))));

    await jest.advanceTimersByTimeAsync(FIRST_MS + TICK_MS * 3);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("[test] Passage impossible.");

    release();
    await jest.advanceTimersByTimeAsync(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("startPeriodicClock_fastPasses_neverWarns", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    startPeriodicClock(clock(async () => undefined));

    await jest.advanceTimersByTimeAsync(FIRST_MS + TICK_MS * 3);

    expect(warnSpy).not.toHaveBeenCalled();
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

describe("restart while a pass is in flight", () => {
  it("startPeriodicClock_restartedDuringSlowPass_firstPassWaitsForIt", async () => {
    let release: () => void = () => undefined;
    const slow = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    startPeriodicClock(clock(slow));
    await jest.advanceTimersByTimeAsync(FIRST_MS);
    void stopPeriodicClock("test-clock");
    const run = jest.fn(async () => undefined);
    startPeriodicClock(clock(run));

    await jest.advanceTimersByTimeAsync(FIRST_MS);
    expect(run).not.toHaveBeenCalled();
    release();
    await jest.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("startPeriodicClock_stoppedAgainWhileWaiting_firstPassDoesNotRun", async () => {
    let release: () => void = () => undefined;
    startPeriodicClock(clock(jest.fn(() => new Promise<void>((resolve) => { release = resolve; }))));
    await jest.advanceTimersByTimeAsync(FIRST_MS);
    void stopPeriodicClock("test-clock");
    const run = jest.fn(async () => undefined);
    startPeriodicClock(clock(run));
    await jest.advanceTimersByTimeAsync(FIRST_MS);
    void stopPeriodicClock("test-clock");

    release();
    await jest.advanceTimersByTimeAsync(0);

    expect(run).not.toHaveBeenCalled();
  });
});

describe("resumeSuspendedPeriodicClocks", () => {
  it("resumeSuspendedPeriodicClocks_afterStopAll_restartsRunningClocks", async () => {
    const run = jest.fn(async () => undefined);
    startPeriodicClock(clock(run));
    await stopAllPeriodicClocks();

    resumeSuspendedPeriodicClocks();
    await jest.advanceTimersByTimeAsync(FIRST_MS);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("resumeSuspendedPeriodicClocks_clockStoppedOnItsOwn_staysStopped", async () => {
    const run = jest.fn(async () => undefined);
    startPeriodicClock(clock(run));
    await stopPeriodicClock("test-clock");
    await stopAllPeriodicClocks();

    resumeSuspendedPeriodicClocks();
    await jest.advanceTimersByTimeAsync(FIRST_MS * 3);

    expect(run).not.toHaveBeenCalled();
  });

  it("resumeSuspendedPeriodicClocks_nothingSuspended_noTimer", () => {
    resumeSuspendedPeriodicClocks();

    expect(jest.getTimerCount()).toBe(0);
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
