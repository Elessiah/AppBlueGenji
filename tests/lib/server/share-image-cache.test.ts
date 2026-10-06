import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { clearCache } from "@/lib/server/cache";
import {
  SHARE_IMAGE_CACHE_MAX_ENTRIES,
  cachedShareImage,
  clearShareImageCache,
} from "@/lib/server/share-image-cache";

/** PNG des cartes d'aperçu gardés en mémoire : fenêtre, vol unique, plafond LRU. */

const png = (text: string) => async () =>
  new Response(text, { headers: { "content-type": "image/png", "cache-control": "public, max-age=60" } });

beforeEach(() => {
  clearCache();
  clearShareImageCache();
  jest.useRealTimers();
});

describe("cachedShareImage", () => {
  it("rend une fois par fenêtre et garde l'en-tête de cache", async () => {
    const build = jest.fn(png("a"));
    const first = await cachedShareImage("fr:a", 1000, build);
    const second = await cachedShareImage("fr:a", 1000, build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(second!.body).toBe(first!.body);
    expect(Buffer.from(first!.body).toString("utf8")).toBe("a");
    expect(first!.cacheControl).toBe("public, max-age=60");
  });

  it("rend à nouveau une fois la fenêtre passée", async () => {
    jest.useFakeTimers({ now: 0 });
    const build = jest.fn(png("a"));
    await cachedShareImage("fr:a", 1000, build);
    jest.setSystemTime(1001);
    await cachedShareImage("fr:a", 1000, build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("partage un rendu en vol entre appels simultanés", async () => {
    const build = jest.fn(png("a"));
    await Promise.all([1, 2, 3].map(() => cachedShareImage("fr:a", 1000, build)));
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("ne garde ni une carte absente ni un échec", async () => {
    const none = jest.fn(async () => null);
    expect(await cachedShareImage("fr:x", 1000, none)).toBeNull();
    expect(await cachedShareImage("fr:x", 1000, none)).toBeNull();
    expect(none).toHaveBeenCalledTimes(2);
    const failing = jest.fn<() => Promise<Response | null>>().mockRejectedValueOnce(new Error("satori"));
    await expect(cachedShareImage("fr:y", 1000, failing)).rejects.toThrow("satori");
    failing.mockImplementation(png("y"));
    expect(await cachedShareImage("fr:y", 1000, failing)).not.toBeNull();
  });

  it("borne le nombre de cartes gardées (LRU)", async () => {
    const builds = new Map<string, jest.Mock<() => Promise<Response | null>>>();
    const build = (key: string) => {
      const fn = builds.get(key) ?? jest.fn(png(key));
      builds.set(key, fn);
      return fn;
    };
    await cachedShareImage("k0", 60_000, build("k0"));
    for (let index = 1; index <= SHARE_IMAGE_CACHE_MAX_ENTRIES; index += 1) {
      // k0 relue à chaque tour : la plus récente, jamais chassée.
      await cachedShareImage("k0", 60_000, build("k0"));
      await cachedShareImage(`k${index}`, 60_000, build(`k${index}`));
    }
    expect(builds.get("k0")).toHaveBeenCalledTimes(1);
    await cachedShareImage("k1", 60_000, build("k1"));
    expect(builds.get("k1")).toHaveBeenCalledTimes(2);
  });
});
