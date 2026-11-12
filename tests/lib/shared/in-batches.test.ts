import { describe, expect, it, jest } from "@jest/globals";
import { createInFlightGate, createLimiter, inBatches, LimiterFullError, mapInBatches, URGENT_STREAK_MAX, withDeadline } from "@/lib/shared/in-batches";

describe("inBatches", () => {
  it("traite chaque élément, jamais plus de `size` à la fois", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await inBatches([1, 2, 3, 4, 5], 2, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setImmediate(resolve));
      done.push(item);
      running -= 1;
    });
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("un élément lent n'immobilise pas les autres places", async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done: number[] = [];
    const all = inBatches([1, 2, 3, 4], 2, async (item) => {
      if (item === 1) await slow;
      done.push(item);
    });
    for (let tick = 0; tick < 20 && done.length < 3; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    // 1 attend encore ; 2, 3 et 4 sont passés par l'autre place.
    expect(done).toEqual([2, 3, 4]);
    release();
    await all;
    expect(done).toEqual([2, 3, 4, 1]);
  });

  it("ne fait rien sur une liste vide", async () => {
    let calls = 0;
    await inBatches([], 4, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it("laisse remonter l'échec d'un élément, après avoir traité tous les autres", async () => {
    const done: number[] = [];
    await expect(
      inBatches([1, 2, 3], 2, async (item) => {
        if (item === 1) throw new Error("échec");
        await new Promise((resolve) => setImmediate(resolve));
        done.push(item);
      }),
    ).rejects.toThrow("échec");
    expect(done.sort((a, b) => a - b)).toEqual([2, 3]);
  });
});

/** Promesse relâchée à la main. */
function held<T>(value: T) {
  let release: () => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    release = () => resolve(value);
  });
  return { promise, release };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Tâche qui note son départ sous `name` dans `started`, puis rend `result` (son nom par défaut). */
function recorded(started: string[], name: string, result: Promise<string> = Promise.resolve(name)) {
  return async (): Promise<string> => {
    started.push(name);
    return result;
  };
}

describe("mapInBatches", () => {
  it("mapInBatches_laterItemFinishesFirst_resultsKeepItemOrder", async () => {
    const first = held("un");

    const mapping = mapInBatches([1, 2, 3], 2, async (item) => (item === 1 ? first.promise : String(item)));
    await tick();
    first.release();

    expect(await mapping).toEqual(["un", "2", "3"]);
  });

  it("mapInBatches_emptyList_returnsEmptyArray", async () => {
    const run = jest.fn(async () => "x");

    expect(await mapInBatches([], 4, run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("mapInBatches_oneItemFails_rejectsAfterAllRan", async () => {
    const ran: number[] = [];

    const mapping = mapInBatches([1, 2, 3], 1, async (item) => {
      ran.push(item);
      if (item === 2) throw new Error("échec");
      return item;
    });

    await expect(mapping).rejects.toThrow("échec");
    expect(ran).toEqual([1, 2, 3]);
  });
});

describe("createLimiter", () => {
  it("createLimiter_moreTasksThanCapacity_neverMoreThanSizeRunning", async () => {
    const limit = createLimiter(2);
    let running = 0;
    let peak = 0;
    const task = (value: number) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      return value;
    };

    const results = await Promise.all([1, 2, 3, 4, 5].map((value) => limit(task(value))));

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("createLimiter_waitingTasks_startInArrivalOrder", async () => {
    const limit = createLimiter(1);
    const first = held("A");
    const started: string[] = [];

    const a = limit(recorded(started, "A", first.promise));
    const b = limit(recorded(started, "B"));
    const c = limit(recorded(started, "C"));
    await tick();
    expect(started).toEqual(["A"]);
    first.release();

    expect(await Promise.all([a, b, c])).toEqual(["A", "B", "C"]);
    expect(started).toEqual(["A", "B", "C"]);
  });

  it("createLimiter_failingTask_releasesItsSlot", async () => {
    const limit = createLimiter(1);

    const failing = limit(async () => {
      throw new Error("refus");
    });
    const next = limit(async () => "suivante");

    await expect(failing).rejects.toThrow("refus");
    expect(await next).toBe("suivante");
  });

  it("createLimiter_sizeZero_stillRunsOneAtATime", async () => {
    const limit = createLimiter(0);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      return "fait";
    };

    expect(await Promise.all([limit(task), limit(task)])).toEqual(["fait", "fait"]);
    expect(peak).toBe(1);
  });

  it("createLimiter_urgentTaskQueued_startsBeforeEarlierOrdinaryTasks", async () => {
    const limit = createLimiter(1);
    const first = held("A");
    const started: string[] = [];

    const a = limit(recorded(started, "A", first.promise));
    const b = limit(recorded(started, "B"));
    const c = limit(recorded(started, "C"), true);
    await tick();
    first.release();

    expect(await Promise.all([a, b, c])).toEqual(["A", "B", "C"]);
    expect(started).toEqual(["A", "C", "B"]);
  });

  it("createLimiter_twoUrgentTasks_startInArrivalOrder", async () => {
    const limit = createLimiter(1);
    const first = held("A");
    const started: string[] = [];

    const a = limit(async () => first.promise);
    const b = limit(recorded(started, "B"), true);
    const c = limit(recorded(started, "C"), true);
    await tick();
    first.release();
    await Promise.all([a, b, c]);

    expect(started).toEqual(["B", "C"]);
  });
});

describe("withDeadline bounds", () => {
  it("withDeadline_taskSettlesBeforeDelay_returnsItsValue", async () => {
    expect(await withDeadline(() => Promise.resolve("fait"), 1_000)).toBe("fait");
  });

  it("withDeadline_taskRejectsBeforeDelay_rejectsWithItsError", async () => {
    await expect(withDeadline(() => Promise.reject(new Error("refus")), 1_000)).rejects.toThrow("refus");
  });

  it("withDeadline_taskNeverSettles_rejectsTimeoutError", async () => {
    jest.useFakeTimers();
    try {
      const bounded = withDeadline(() => new Promise<string>(() => undefined), 30_000);
      const outcome = expect(bounded).rejects.toMatchObject({ name: "TimeoutError" });

      await jest.advanceTimersByTimeAsync(30_000);

      await outcome;
    } finally {
      jest.useRealTimers();
    }
  });

  it("withDeadline_oneMsBeforeDelay_stillPending", async () => {
    jest.useFakeTimers();
    try {
      let settled = false;
      void withDeadline(() => new Promise<string>(() => undefined), 30_000).catch(() => {
        settled = true;
      });

      await jest.advanceTimersByTimeAsync(29_999);

      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("withDeadline synchronous throw", () => {
  it("withDeadline_taskThrowsSynchronously_rejectsAndArmsNoTimer", async () => {
    jest.useFakeTimers();
    try {
      const outcome = withDeadline((): Promise<string> => {
        throw new Error("garde");
      }, 30_000);

      await expect(outcome).rejects.toThrow("garde");
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("inBatches options", () => {
  it("inBatches_failFast_startsNoItemAfterFirstFailure", async () => {
    const ran: number[] = [];

    const batch = inBatches(
      [1, 2, 3, 4, 5, 6],
      2,
      async (item) => {
        ran.push(item);
        if (item === 1) throw new Error("échec");
        await tick();
      },
      { failFast: true },
    );

    await expect(batch).rejects.toThrow("échec");
    expect(ran).toEqual([1, 2]);
  });

  it("inBatches_signalAborted_startsNoNewItemButFinishesRunningOnes", async () => {
    const controller = new AbortController();
    const ran: number[] = [];
    const first = held("un");

    const batch = inBatches(
      [1, 2, 3],
      1,
      async (item) => {
        ran.push(item);
        await first.promise;
      },
      { signal: controller.signal },
    );
    await tick();
    controller.abort();
    first.release();
    await batch;

    expect(ran).toEqual([1]);
  });

  it("mapInBatches_signalAlreadyAborted_runsNothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = jest.fn(async () => "x");

    await mapInBatches([1, 2], 2, run, { signal: controller.signal });

    expect(run).not.toHaveBeenCalled();
  });
});

describe("createLimiter bounds", () => {
  it("createLimiter_waitingQueueFull_refusesOrdinaryTaskButNotUrgent", async () => {
    const limit = createLimiter(1, 1);
    const first = held("A");
    const a = limit(async () => first.promise);
    const b = limit(async () => "B");

    await expect(limit(async () => "C")).rejects.toBeInstanceOf(LimiterFullError);
    const urgent = limit(async () => "U", true);
    first.release();

    expect(await Promise.all([a, b, urgent])).toEqual(["A", "B", "U"]);
  });

  it("createLimiter_manyUrgentTasks_ordinaryTaskStillGetsItsTurn", async () => {
    const limit = createLimiter(1);
    const first = held("A");
    const started: string[] = [];

    const all = [limit(recorded(started, "A", first.promise))];
    all.push(limit(recorded(started, "ordinary")));
    for (let i = 0; i < URGENT_STREAK_MAX + 3; i += 1) all.push(limit(recorded(started, `u${i}`), true));
    await tick();
    first.release();
    await Promise.all(all);

    // Après URGENT_STREAK_MAX urgentes de suite, l'ordinaire passe avant les suivantes.
    expect(started.indexOf("ordinary")).toBe(URGENT_STREAK_MAX + 1);
  });
});

describe("withDeadline", () => {
  it("withDeadline_delayElapsed_abortsSignalAndRejects", async () => {
    jest.useFakeTimers();
    try {
      let received: AbortSignal | undefined;
      const outcome = withDeadline((signal) => {
        received = signal;
        return new Promise<string>(() => undefined);
      }, 1_000).catch((error: Error) => error.name);

      expect(received?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1_000);

      expect(await outcome).toBe("TimeoutError");
      expect(received?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("withDeadline_taskSettlesInTime_leavesSignalUntouched", async () => {
    let received: AbortSignal | undefined;

    const result = await withDeadline(async (signal) => {
      received = signal;
      return "fait";
    }, 1_000);

    expect(result).toBe("fait");
    expect(received?.aborted).toBe(false);
  });
});

describe("createInFlightGate", () => {
  it("createInFlightGate_full_refusesUntilOneLeaves", () => {
    const gate = createInFlightGate(2, 60_000);
    const first = gate.tryEnter();
    gate.tryEnter();

    expect(gate.tryEnter()).toBeNull();
    first?.leave();
    expect(gate.tryEnter()).not.toBeNull();
  });

  it("createInFlightGate_leaveCalledTwice_countsOnce", () => {
    const gate = createInFlightGate(2, 60_000);
    const ticket = gate.tryEnter();
    gate.tryEnter();

    ticket?.leave();
    ticket?.leave();

    expect(gate.count).toBe(1);
  });

  it("createInFlightGate_expiredWorkNeverReturns_forgottenAfterAbandonDelay", async () => {
    jest.useFakeTimers();
    try {
      const forgotten = jest.fn();
      const gate = createInFlightGate(1, 60_000, forgotten);
      gate.tryEnter()?.expire();

      await jest.advanceTimersByTimeAsync(59_999);
      expect(gate.tryEnter()).toBeNull();
      await jest.advanceTimersByTimeAsync(1);

      expect(forgotten).toHaveBeenCalledTimes(1);
      expect(gate.count).toBe(0);
      expect(gate.forgotten).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("createInFlightGate_notExpired_neverForgottenAndNoTimer", async () => {
    jest.useFakeTimers();
    try {
      const forgotten = jest.fn();
      const gate = createInFlightGate(1, 60_000, forgotten);
      gate.tryEnter();

      await jest.advanceTimersByTimeAsync(10 * 60_000);

      expect(forgotten).not.toHaveBeenCalled();
      expect(gate.count).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("createInFlightGate_leftBeforeAbandonDelay_neverForgotten", async () => {
    jest.useFakeTimers();
    try {
      const forgotten = jest.fn();
      const gate = createInFlightGate(1, 60_000, forgotten);
      const ticket = gate.tryEnter();
      ticket?.expire();
      ticket?.leave();

      await jest.advanceTimersByTimeAsync(60_000);

      expect(forgotten).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("createInFlightGate_forgottenWorkStillUnsettled_countsTowardUnsettledMax", async () => {
    jest.useFakeTimers();
    try {
      const gate = createInFlightGate(1, 60_000, undefined, 2);
      gate.tryEnter()?.expire();
      await jest.advanceTimersByTimeAsync(60_000);

      const second = gate.tryEnter();

      expect(second).not.toBeNull();
      expect(gate.tryEnter()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("createInFlightGate_forgottenWorkFinallyReturns_freesItsUnsettledPlace", async () => {
    jest.useFakeTimers();
    try {
      const gate = createInFlightGate(1, 60_000, undefined, 1);
      const hung = gate.tryEnter();
      hung?.expire();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(gate.tryEnter()).toBeNull();

      hung?.leave();

      expect(gate.forgotten).toBe(0);
      expect(gate.tryEnter()).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
