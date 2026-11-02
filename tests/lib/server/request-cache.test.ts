import { describe, expect, it, jest } from "@jest/globals";

/** Mémoïsation par requête (`cache` de React), avec repli sans `cache` (React 18.3 sous Jest) — EF-31. */
describe("requestCache", () => {
  it("requestCache_reactWithoutCache_returnsSameFunction", () => {
    const { requestCache } = jest.requireActual<typeof import("@/lib/server/request-cache")>("@/lib/server/request-cache");
    const read = (id: number) => id * 2;

    expect(requestCache(read)).toBe(read);
  });

  it("requestCache_reactWithCache_usesIt", () => {
    jest.resetModules();
    const memoized = (id: number) => id;
    const cache = jest.fn(() => memoized);
    jest.doMock("react", () => ({ ...jest.requireActual<object>("react"), cache }));
    const { requestCache } = jest.requireActual<typeof import("@/lib/server/request-cache")>("@/lib/server/request-cache");

    expect(requestCache((id: number) => id + 1)).toBe(memoized);
    expect(cache).toHaveBeenCalledTimes(1);
    jest.dontMock("react");
  });
});
