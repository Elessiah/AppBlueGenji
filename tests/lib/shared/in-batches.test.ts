import { describe, expect, it } from "@jest/globals";
import { inBatches } from "@/lib/shared/in-batches";

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

  it("laisse remonter l'échec d'un élément", async () => {
    await expect(
      inBatches([1], 4, async () => {
        throw new Error("échec");
      }),
    ).rejects.toThrow("échec");
  });
});
