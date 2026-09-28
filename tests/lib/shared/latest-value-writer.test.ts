import { describe, expect, it, jest } from "@jest/globals";
import { createLatestValueWriter } from "@/lib/shared/latest-value-writer";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Laisse partir l'écriture en tête de file. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("createLatestValueWriter", () => {
  it("regroupe des gestes simultanés en une seule écriture, avec le dernier", async () => {
    const write = jest.fn(async (_value: string) => undefined);
    const writer = createLatestValueWriter(write);

    await Promise.all([writer.submit("A"), writer.submit("B")]);

    expect(write.mock.calls.map(([value]) => value)).toEqual(["B"]);
  });

  it("écrit en série, et ne garde que le dernier geste arrivé pendant une écriture", async () => {
    const first = deferred();
    const written: string[] = [];
    const writer = createLatestValueWriter(async (value: string) => {
      written.push(value);
      if (value === "A") await first.promise;
    });

    const a = writer.submit("A");
    await tick();
    const b = writer.submit("B");
    const c = writer.submit("C");
    // B et C rejoignent la même écriture, qui attend la première.
    expect(b).toBe(c);
    await tick();
    expect(written).toEqual(["A"]);

    first.resolve();
    await Promise.all([a, b, c]);
    expect(written).toEqual(["A", "C"]);
  });

  it("fait suivre un échec aux gestes qu'il porte, sans bloquer la file", async () => {
    const gate = deferred();
    const written: number[] = [];
    const writer = createLatestValueWriter(async (value: number) => {
      written.push(value);
      if (value === 1) await gate.promise;
      if (value === 2) throw new Error("refus");
    });

    const one = writer.submit(1);
    await tick();
    const two = writer.submit(2);
    gate.resolve();
    await one;
    await expect(two).rejects.toThrow("refus");

    await expect(writer.submit(3)).resolves.toBeUndefined();
    expect(written).toEqual([1, 2, 3]);
  });
});
