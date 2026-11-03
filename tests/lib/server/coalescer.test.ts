import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createCoalescer } from "@/lib/server/coalescer";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

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

  it("une annonce qui lève ne casse ni le minuteur ni les rafales suivantes", () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const deliver = jest.fn<(first: number, last: number) => void>().mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const coalescer = createCoalescer<number>({ windowMs: 1_000, maxAgeMs: 5_000, deliver });
    coalescer.add("a", 1);
    jest.advanceTimersByTime(1_000);
    expect(error).toHaveBeenCalledWith("[coalescer] annonce regroupée non partie", "boom");
    coalescer.add("a", 2);
    jest.advanceTimersByTime(1_000);
    expect(deliver).toHaveBeenLastCalledWith(2, 2);
    error.mockRestore();
  });
});
