import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { boundedWait } from "@/lib/server/bounded-wait";

/** Attente bornée de l'arrêt du serveur (`bot-log-shutdown.ts`). */
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("boundedWait", () => {
  it("boundedWait_workResolves_resolvesWithoutTimer", async () => {
    await expect(boundedWait(Promise.resolve("done"), 1_000)).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("boundedWait_workHangs_resolvesAtTheTimeout", async () => {
    const done = jest.fn();
    void boundedWait(new Promise<void>(() => undefined), 500).then(done);

    await jest.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });

  it("boundedWait_workRejects_neverThrows", async () => {
    await expect(boundedWait(Promise.reject(new Error("db")), 1_000)).resolves.toBeUndefined();
  });

  it("boundedWait_negativeTimeout_resolvesAtOnce", async () => {
    const done = jest.fn();
    void boundedWait(new Promise<void>(() => undefined), -50).then(done);

    await jest.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalled();
  });

  it("boundedWait_noWork_resolves", async () => {
    await expect(boundedWait(undefined, 1_000)).resolves.toBeUndefined();
  });
});
