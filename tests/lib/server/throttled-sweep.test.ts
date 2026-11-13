import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { throttledSweep } from "@/lib/server/throttled-sweep";
import { outboundMuted } from "@/lib/server/outbound-mute";

jest.mock("@/lib/server/outbound-mute", () => ({ outboundMuted: jest.fn(() => false) }));

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function sweeper(sweep = jest.fn(async () => 3)) {
  const onError = jest.fn();
  return { sweeps: throttledSweep({ throttleMs: 10_000, sweep, onError }), sweep, onError };
}

describe("throttledSweep", () => {
  it("run_firstCall_runsTheSweepAndReturnsItsCount", async () => {
    const { sweeps, sweep } = sweeper();

    expect(await sweeps.run()).toBe(3);

    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("run_withinThrottle_returnsZeroThenTrailingSweepRunsOnceTheDelayIsOver", async () => {
    const { sweeps, sweep } = sweeper();
    await sweeps.run();

    expect(await sweeps.run()).toBe(0);
    expect(await sweeps.run()).toBe(0);
    expect(sweep).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(10_000);
    // Un seul minuteur pour les deux appels étranglés.
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("run_whileASweepIsPending_sharesItsResultAndArmsTheTrailingSweep", async () => {
    const finishers: ((count: number) => void)[] = [];
    const sweep = jest.fn(() => new Promise<number>((resolve) => finishers.push(resolve)));
    const { sweeps } = sweeper(sweep);

    const first = sweeps.run();
    const second = sweeps.run();
    finishers[0](2);

    expect(await first).toBe(2);
    expect(await second).toBe(2);
    expect(sweep).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("run_sweepThrows_reportsTheErrorAndReturnsZero", async () => {
    const failure = new Error("DB_DOWN");
    const { sweeps, onError } = sweeper(jest.fn(async () => Promise.reject(failure)));

    expect(await sweeps.run()).toBe(0);

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("schedule_calledTwice_singleTimer", async () => {
    const { sweeps, sweep } = sweeper();

    sweeps.schedule(1_000);
    sweeps.schedule(1_000);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("run_disabled_returnsZeroWithoutSweeping", async () => {
    const sweep = jest.fn(async () => 3);
    const sweeps = throttledSweep({ throttleMs: 10_000, sweep, onError: jest.fn(), enabled: () => false });

    expect(await sweeps.run()).toBe(0);

    expect(sweep).not.toHaveBeenCalled();
  });

  it("schedule_disabledBeforeTheTimerFires_trailingSweepSkipped", async () => {
    let enabled = true;
    const sweep = jest.fn(async () => 3);
    const sweeps = throttledSweep({ throttleMs: 10_000, sweep, onError: jest.fn(), enabled: () => enabled });
    await sweeps.run();
    await sweeps.run();

    enabled = false;
    await jest.advanceTimersByTimeAsync(10_000);

    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("reset_afterASweep_nextCallRunsAtOnceAndPendingTimerIsCancelled", async () => {
    const { sweeps, sweep } = sweeper();
    await sweeps.run();
    await sweeps.run();

    sweeps.reset();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(await sweeps.run()).toBe(3);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
  // EF-62 (revue standard, cycle 3) : envois coupés (rejeu d'une
  // restauration), aucun balayage ne réserve de notification qu'il ne pourrait
  // envoyer.
  it("run_outboundMuted_returnsZeroWithoutSweeping", async () => {
    jest.mocked(outboundMuted).mockReturnValueOnce(true);
    const { sweeps, sweep } = sweeper();

    expect(await sweeps.run()).toBe(0);

    expect(sweep).not.toHaveBeenCalled();
  });
});
