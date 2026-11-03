import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createCoalescer, createKeyedChain, flushAllCoalescers, trackAnnouncement } from "@/lib/server/coalescer";

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

function setup() {
  const deliver = jest.fn<(first: number, last: number) => void>();
  const coalescer = createCoalescer<number>({ windowMs: 1_000, maxAgeMs: 5_000, deliver });
  return { deliver, coalescer };
}

describe("createCoalescer", () => {
  it("un geste seul part après le silence, avec lui-même comme premier et dernier", () => {
    const { deliver, coalescer } = setup();
    coalescer.add("a", 1);
    jest.advanceTimersByTime(999);
    expect(deliver).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(deliver).toHaveBeenCalledWith(1, 1);
    expect(coalescer.pending()).toBe(0);
  });

  it("chaque geste relance le silence ; la rafale part une fois, premier et dernier geste", () => {
    const { deliver, coalescer } = setup();
    coalescer.add("a", 1);
    jest.advanceTimersByTime(900);
    coalescer.add("a", 2);
    jest.advanceTimersByTime(900);
    coalescer.add("a", 3);
    jest.advanceTimersByTime(999);
    expect(deliver).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(1, 3);
  });

  it("une rafale sans silence part à l'âge maximal", () => {
    const { deliver, coalescer } = setup();
    for (let i = 0; i < 10; i++) {
      coalescer.add("a", i);
      jest.advanceTimersByTime(500);
    }
    // Premier geste à 0, âge maximal à 5 000 : la rafale est partie avec le dernier geste reçu avant.
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(0, 9);
  });

  it("deux clés sont deux rafales", () => {
    const { deliver, coalescer } = setup();
    coalescer.add("a", 1);
    coalescer.add("b", 2);
    expect(coalescer.pending()).toBe(2);
    jest.advanceTimersByTime(1_000);
    expect(deliver).toHaveBeenCalledWith(1, 1);
    expect(deliver).toHaveBeenCalledWith(2, 2);
  });

  it("flushAll annonce tout de suite, reset abandonne sans annoncer", () => {
    const { deliver, coalescer } = setup();
    coalescer.add("a", 1);
    coalescer.flushAll();
    expect(deliver).toHaveBeenCalledWith(1, 1);
    coalescer.add("b", 2);
    coalescer.reset();
    jest.advanceTimersByTime(10_000);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(coalescer.pending()).toBe(0);
  });

  it("createCoalescer_deliveryRejectsWithCodedError_logsCodeNotMessage", () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const deliver = jest.fn<(first: number, last: number) => void>().mockImplementationOnce(() => {
      throw Object.assign(new Error("Duplicate entry 'Renards' for key 'name'"), { code: "ER_DUP_ENTRY" });
    });
    const coalescer = createCoalescer<number>({ windowMs: 1_000, maxAgeMs: 5_000, deliver });
    coalescer.add("a", 1);
    jest.advanceTimersByTime(1_000);
    expect(error).toHaveBeenCalledWith("[coalescer] annonce regroupée non partie", "ER_DUP_ENTRY");
    expect(JSON.stringify(error.mock.calls)).not.toContain("Renards");
    error.mockRestore();
  });

  it("une annonce qui lève ne casse ni le minuteur ni les rafales suivantes", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const deliver = jest.fn<(first: number, last: number) => void>().mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const coalescer = createCoalescer<number>({ windowMs: 1_000, maxAgeMs: 5_000, deliver });
    coalescer.add("a", 1);
    jest.advanceTimersByTime(1_000);
    expect(error).toHaveBeenCalledWith("[coalescer] annonce regroupée non partie", "Error");
    await Promise.resolve();
    await Promise.resolve();
    coalescer.add("a", 2);
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(deliver).toHaveBeenLastCalledWith(2, 2);
    error.mockRestore();
  });
});

describe("createCoalescer — annonce forcée", () => {
  it("flush_pendingKey_deliversAtOnceAndClearsBurst", async () => {
    const { deliver, coalescer } = setup();
    coalescer.add("a", 1);
    coalescer.add("a", 2);
    await coalescer.flush("a");
    expect(deliver).toHaveBeenCalledWith(1, 2);
    expect(coalescer.pending()).toBe(0);
    jest.advanceTimersByTime(10_000);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("flush_deliveryInFlight_waitsForItBeforeResolving", async () => {
    let finish: () => void = () => undefined;
    const done: string[] = [];
    const coalescer = createCoalescer<number>({
      windowMs: 1_000,
      maxAgeMs: 5_000,
      deliver: (_first, last) =>
        new Promise<void>((resolve) => {
          finish = () => {
            done.push(`delivered ${last}`);
            resolve();
          };
        }),
    });
    coalescer.add("a", 1);
    jest.advanceTimersByTime(1_000);
    expect(coalescer.pending()).toBe(0);
    const flushed = coalescer.flush("a").then(() => done.push("flushed"));
    await Promise.resolve();
    expect(done).toEqual([]);
    finish();
    await flushed;
    expect(done).toEqual(["delivered 1", "flushed"]);
  });

  it("flushAll_deliveryInFlight_waitsForIt", async () => {
    let finish: () => void = () => undefined;
    const done: string[] = [];
    const coalescer = createCoalescer<number>({
      windowMs: 1_000,
      maxAgeMs: 5_000,
      deliver: () =>
        new Promise<void>((resolve) => {
          finish = () => {
            done.push("delivered");
            resolve();
          };
        }),
    });
    coalescer.add("a", 1);
    jest.advanceTimersByTime(1_000);
    const flushed = coalescer.flushAll().then(() => done.push("flushed"));
    await Promise.resolve();
    finish();
    await flushed;
    expect(done).toEqual(["delivered", "flushed"]);
  });

  it("fire_previousDeliveryStillRunning_nextWaitsForIt", async () => {
    const events: string[] = [];
    const finishes: (() => void)[] = [];
    const coalescer = createCoalescer<number>({
      windowMs: 1_000,
      maxAgeMs: 5_000,
      deliver: (_first, last) =>
        new Promise<void>((resolve) => {
          events.push(`start ${last}`);
          finishes.push(() => {
            events.push(`end ${last}`);
            resolve();
          });
        }),
    });
    coalescer.add("a", 1);
    jest.advanceTimersByTime(1_000);
    coalescer.add("a", 2);
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(events).toEqual(["start 1"]);
    finishes[0]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["start 1", "end 1", "start 2"]);
    coalescer.reset();
  });

  it("busy_pendingInFlightAndUnknown_trueTrueFalse", async () => {
    let finish: () => void = () => undefined;
    const coalescer = createCoalescer<number>({
      windowMs: 1_000,
      maxAgeMs: 5_000,
      deliver: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    expect(coalescer.busy("a")).toBe(false);
    coalescer.add("a", 1);
    expect(coalescer.busy("a")).toBe(true);
    jest.advanceTimersByTime(1_000);
    expect(coalescer.busy("a")).toBe(true);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(coalescer.busy("a")).toBe(false);
  });

  it("waiting_openBurst_trueThenFalseAfterFlush", async () => {
    const coalescer = createCoalescer<number>({ windowMs: 1_000, maxAgeMs: 5_000, deliver: () => undefined });
    expect(coalescer.waiting("a")).toBe(false);
    coalescer.add("a", 1);
    expect(coalescer.waiting("a")).toBe(true);
    await coalescer.flush("a");
    expect(coalescer.waiting("a")).toBe(false);
  });

  it("drain_inFlightDelivery_waitsWithoutFiringOpenBurst", async () => {
    let finish: () => void = () => undefined;
    const deliver = jest
      .fn<(first: number, last: number) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      .mockResolvedValue();
    const coalescer = createCoalescer<number>({ windowMs: 1_000, maxAgeMs: 5_000, deliver });
    coalescer.add("a", 1);
    jest.advanceTimersByTime(1_000);
    coalescer.add("a", 2);
    const drained = coalescer.drain("a");
    finish();
    await drained;
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(coalescer.waiting("a")).toBe(true);
  });

  it("flush_gestureAddedAfterCall_opensNextBurst", async () => {
    const deliver = jest.fn<(first: number, last: number) => void>();
    const coalescer = createCoalescer<number>({ windowMs: 1_000, maxAgeMs: 5_000, deliver });
    coalescer.add("a", 1);
    const flushed = coalescer.flush("a");
    coalescer.add("a", 2);
    await flushed;
    expect(deliver).toHaveBeenCalledWith(1, 1);
    expect(coalescer.waiting("a")).toBe(true);
  });

  it("flushAllCoalescers_trackedAnnouncementPending_waitsForIt", async () => {
    let finish: () => void = () => undefined;
    const done: string[] = [];
    trackAnnouncement(new Promise<void>((resolve) => (finish = resolve)).then(() => void done.push("announced")));
    const flushed = flushAllCoalescers().then(() => done.push("flushed"));
    await Promise.resolve();
    expect(done).toEqual([]);
    finish();
    await flushed;
    expect(done).toEqual(["announced", "flushed"]);
  });

  it("trackAnnouncement_rejectedPromise_forgottenAndFlushResolves", async () => {
    const rejected = Promise.reject(new Error("boom"));
    trackAnnouncement(rejected).catch(() => undefined);
    await expect(flushAllCoalescers()).resolves.toBeUndefined();
    await expect(flushAllCoalescers()).resolves.toBeUndefined();
  });

  it("flush_unknownKey_resolvesWithoutDelivering", async () => {
    const { deliver, coalescer } = setup();
    coalescer.add("a", 1);
    await expect(coalescer.flush("x")).resolves.toBeUndefined();
    expect(deliver).not.toHaveBeenCalled();
    expect(coalescer.pending()).toBe(1);
  });

  it("flushAll_asyncDeliver_resolvesAfterDeliveries", async () => {
    const delivered: number[] = [];
    const coalescer = createCoalescer<number>({
      windowMs: 1_000,
      maxAgeMs: 5_000,
      deliver: async (_first, last) => {
        await Promise.resolve();
        delivered.push(last);
      },
    });
    coalescer.add("a", 1);
    coalescer.add("b", 2);
    await coalescer.flushAll();
    expect(delivered).toEqual([1, 2]);
  });

  it("flush_deliverRejects_logsAndResolves", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const coalescer = createCoalescer<number>({
      windowMs: 1_000,
      maxAgeMs: 5_000,
      deliver: async () => {
        throw new Error("boom");
      },
    });
    coalescer.add("a", 1);
    await expect(coalescer.flush("a")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("[coalescer] annonce regroupée non partie", "Error");
    error.mockRestore();
  });

  it("flushAllCoalescers_moduleLoadedTwice_seesTheOtherCopiesBursts", async () => {
    const deliver = jest.fn<(first: number, last: number) => void>();
    jest.isolateModules(() => {
      const other = require("@/lib/server/coalescer") as typeof import("@/lib/server/coalescer");
      other.createCoalescer<number>({ windowMs: 1_000, maxAgeMs: 5_000, deliver }).add("a", 7);
    });
    await flushAllCoalescers();
    expect(deliver).toHaveBeenCalledWith(7, 7);
  });

  it("flushAllCoalescers_twoCoalescers_flushesBoth", async () => {
    const first = setup();
    const second = setup();
    first.coalescer.add("a", 1);
    second.coalescer.add("b", 2);
    await flushAllCoalescers();
    expect(first.deliver).toHaveBeenCalledWith(1, 1);
    expect(second.deliver).toHaveBeenCalledWith(2, 2);
  });
});

describe("createKeyedChain", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  function deferred() {
    let release: () => void = () => undefined;
    let fail: () => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = () => reject(new Error("BOT_DOWN"));
    });
    return { promise, release, fail };
  }

  it("createKeyedChain_sameKey_runsAfterPrevious", async () => {
    const { chain } = createKeyedChain<number>();
    const first = deferred();
    const second = jest.fn(async () => undefined);
    chain(1, () => first.promise);
    chain(1, second);
    await Promise.resolve();
    expect(second).not.toHaveBeenCalled();
    first.release();
    await flushAllCoalescers();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("createKeyedChain_otherKey_startsImmediately", async () => {
    const { chain } = createKeyedChain<number>();
    const first = deferred();
    const other = jest.fn(async () => undefined);
    chain(1, () => first.promise);
    chain(2, other);
    expect(other).toHaveBeenCalledTimes(1);
    first.release();
    await flushAllCoalescers();
  });

  it("createKeyedChain_previousRejects_nextStillRuns", async () => {
    const { chain } = createKeyedChain<number>();
    const first = deferred();
    const second = jest.fn(async () => undefined);
    chain(1, () => first.promise);
    chain(1, second);
    first.fail();
    await flushAllCoalescers();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("chain_runResolves_returnedPromiseResolvesAfterRun", async () => {
    const { chain } = createKeyedChain<number>();
    const run = deferred();
    let done = false;
    const settled = chain(1, () => run.promise).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    run.release();
    await settled;
    expect(done).toBe(true);
  });

  it("chain_runRejects_returnedPromiseResolves", async () => {
    const { chain } = createKeyedChain<number>();
    const run = deferred();
    const settled = chain(1, () => run.promise);
    run.fail();
    await expect(settled).resolves.toBeUndefined();
  });

  it("createKeyedChain_runThrowsSynchronously_doesNotThrow", async () => {
    const { chain } = createKeyedChain<number>();
    const next = jest.fn(async () => undefined);
    expect(() =>
      chain(1, () => {
        throw new Error("SYNC_FAILURE");
      }),
    ).not.toThrow();
    chain(1, next);
    await flushAllCoalescers();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("createKeyedChain_pendingRun_awaitedByFlushAllCoalescers", async () => {
    const { chain } = createKeyedChain<number>();
    const run = deferred();
    let flushed = false;
    chain(1, () => run.promise);
    const flushing = flushAllCoalescers().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    run.release();
    await flushing;
    expect(flushed).toBe(true);
  });
});

describe("createCoalescer — deliverQueues", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  function slowFirstDelivery() {
    let releaseFirst: () => void = () => undefined;
    const deliver = jest
      .fn<(first: number, last: number) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValue();
    return { deliver, release: () => releaseFirst() };
  }

  it("flush_deliverQueuesWithBurstInFlight_deliversSameTick", async () => {
    const { deliver, release } = slowFirstDelivery();
    const coalescer = createCoalescer<number>({ windowMs: 1_000, maxAgeMs: 5_000, deliver, deliverQueues: true });
    coalescer.add("a", 1);
    const first = coalescer.flush("a");
    coalescer.add("a", 2);
    let settled = false;
    const second = coalescer.flush("a").then(() => {
      settled = true;
    });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenLastCalledWith(2, 2);
    release();
    await Promise.all([first, second]);
    expect(settled).toBe(true);
  });

  it("flush_defaultWithBurstInFlight_waitsPrevious", async () => {
    const { deliver, release } = slowFirstDelivery();
    const coalescer = createCoalescer<number>({ windowMs: 1_000, maxAgeMs: 5_000, deliver });
    coalescer.add("a", 1);
    const first = coalescer.flush("a");
    coalescer.add("a", 2);
    const second = coalescer.flush("a");
    await Promise.resolve();
    expect(deliver).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});
