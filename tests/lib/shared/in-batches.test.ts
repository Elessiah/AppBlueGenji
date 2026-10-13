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
