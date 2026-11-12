import { describe, expect, it, jest } from "@jest/globals";
import { createLimiter, inBatches, mapInBatches } from "@/lib/shared/in-batches";

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

    const a = limit(async () => {
      started.push("A");
      return first.promise;
    });
    const b = limit(async () => {
      started.push("B");
      return "B";
    });
    const c = limit(async () => {
      started.push("C");
      return "C";
    });
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
});
