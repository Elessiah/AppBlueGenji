/**
 * Relecture de l'archive des terminés après un échec (`_lib/archive-retry.ts`) :
 * bornée, espacée, une tentative à la fois, suspendue onglet caché, arrêtée net.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  archiveRetryDelay,
  startArchiveRetry,
  type ArchiveAttemptOutcome,
  type ArchiveRetryEnv,
} from "@/app/(secured)/tournois/_lib/archive-retry";

/** Onglet piloté par le test : visibilité et retour au premier plan. */
function fakeTab(hidden = false) {
  let isHidden = hidden;
  const listeners = new Set<() => void>();
  const env: ArchiveRetryEnv = {
    isHidden: () => isHidden,
    onVisible: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  return {
    env,
    listeners,
    show: () => {
      isHidden = false;
      for (const listener of [...listeners]) listener();
    },
  };
}

const always = (outcome: ArchiveAttemptOutcome) =>
  jest.fn<(signal: AbortSignal) => Promise<ArchiveAttemptOutcome>>(() => Promise.resolve(outcome));

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("archiveRetryDelay", () => {
  it("archiveRetryDelay_firstToFourthAttempt_returnsGrowingDelays", () => {
    expect([0, 1, 2, 3].map(archiveRetryDelay)).toEqual([15_000, 30_000, 60_000, 120_000]);
  });

  it("archiveRetryDelay_beyondTable_returnsNull", () => {
    expect(archiveRetryDelay(4)).toBeNull();
  });
});

describe("startArchiveRetry", () => {
  it("startArchiveRetry_failedAttempts_retriesAtGrowingDelaysThenStops", async () => {
    const attempt = always("failed");
    startArchiveRetry(attempt, fakeTab().env);

    await jest.advanceTimersByTimeAsync(14_999);
    expect(attempt).toHaveBeenCalledTimes(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(attempt).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(attempt).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(attempt).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it("startArchiveRetry_okOutcome_stopsSeries", async () => {
    const attempt = always("ok");
    startArchiveRetry(attempt, fakeTab().env);

    await jest.advanceTimersByTimeAsync(600_000);

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("startArchiveRetry_stopOutcome_stopsSeries", async () => {
    const attempt = always("stop");
    startArchiveRetry(attempt, fakeTab().env);

    await jest.advanceTimersByTimeAsync(600_000);

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("startArchiveRetry_slowAttempt_neverOverlaps", async () => {
    const pending: { settle?: (outcome: ArchiveAttemptOutcome) => void } = {};
    const attempt = jest.fn<(signal: AbortSignal) => Promise<ArchiveAttemptOutcome>>(
      () =>
        new Promise((resolve) => {
          pending.settle = resolve;
        }),
    );
    startArchiveRetry(attempt, fakeTab().env);

    await jest.advanceTimersByTimeAsync(15_000 + 300_000);
    expect(attempt).toHaveBeenCalledTimes(1);

    pending.settle?.("failed");
    await jest.advanceTimersByTimeAsync(30_000);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("startArchiveRetry_rejectedAttempt_schedulesNext", async () => {
    const attempt = jest.fn<(signal: AbortSignal) => Promise<ArchiveAttemptOutcome>>(() =>
      Promise.reject(new Error("boom")),
    );
    startArchiveRetry(attempt, fakeTab().env);

    await jest.advanceTimersByTimeAsync(45_000);

    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("startArchiveRetry_hiddenTab_waitsForVisibleThenFires", async () => {
    const tab = fakeTab(true);
    const attempt = always("ok");
    startArchiveRetry(attempt, tab.env);

    await jest.advanceTimersByTimeAsync(600_000);
    expect(attempt).toHaveBeenCalledTimes(0);

    tab.show();
    await jest.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(tab.listeners.size).toBe(0);
  });

  it("startArchiveRetry_cancel_clearsTimerAndAbortsInFlightAttempt", async () => {
    let received: AbortSignal | undefined;
    const attempt = jest.fn<(signal: AbortSignal) => Promise<ArchiveAttemptOutcome>>((signal) => {
      received = signal;
      return new Promise(() => undefined);
    });
    const cancel = startArchiveRetry(attempt, fakeTab().env);
    await jest.advanceTimersByTimeAsync(15_000);

    cancel();

    expect(received?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("startArchiveRetry_cancelBeforeFirstAttempt_neverAttempts", async () => {
    const attempt = always("failed");
    const cancel = startArchiveRetry(attempt, fakeTab().env);

    cancel();
    await jest.advanceTimersByTimeAsync(600_000);

    expect(attempt).toHaveBeenCalledTimes(0);
  });

  it("startArchiveRetry_cancelWhileHidden_unsubscribesVisibility", async () => {
    const tab = fakeTab(true);
    const attempt = always("ok");
    const cancel = startArchiveRetry(attempt, tab.env);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(tab.listeners.size).toBe(1);

    cancel();

    expect(tab.listeners.size).toBe(0);
    tab.show();
    expect(attempt).toHaveBeenCalledTimes(0);
  });
});
