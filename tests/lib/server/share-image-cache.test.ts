import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { clearCache } from "@/lib/server/cache";
import {
  MAX_CONCURRENT_RENDERS,
  MAX_QUEUED_EMBED_RENDERS,
  MAX_RENDER_WAIT_CLIENT_MS,
  queuedShareRenderClients,
  MAX_QUEUED_EMBED_RENDERS_PER_CLIENT,
  queuedShareRenders,
  type ShareRenderAdmission,
  SHARE_IMAGE_POOL_LIMITS,
  cachedShareImage,
  clearShareImageCache,
  invalidateRankingShareImages,
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

  it("ne laisse jamais les cartes d'équipe chasser les cartes fixes", async () => {
    const fixed = jest.fn(png("fixed"));
    await cachedShareImage("fr:association", 60_000, fixed);
    for (let index = 0; index < SHARE_IMAGE_POOL_LIMITS.team * 3; index += 1) {
      await cachedShareImage(`fr:team-${index}`, 60_000, png(`t${index}`), "team");
    }
    await cachedShareImage("fr:association", 60_000, fixed);
    expect(fixed).toHaveBeenCalledTimes(1);
  });

  it("garde un tableau de 63 matchs en deux langues dans la réserve des aperçus", () => {
    expect(SHARE_IMAGE_POOL_LIMITS.embed).toBeGreaterThanOrEqual(63 * 2 + 2);
  });

  it("borne la réserve des équipes (LRU)", async () => {
    const first = jest.fn(png("t0"));
    await cachedShareImage("fr:team-0", 60_000, first, "team");
    for (let index = 1; index <= SHARE_IMAGE_POOL_LIMITS.team; index += 1) {
      await cachedShareImage(`fr:team-${index}`, 60_000, png(`t${index}`), "team");
    }
    await cachedShareImage("fr:team-0", 60_000, first, "team");
    expect(first).toHaveBeenCalledTimes(2);
  });

  it(`ne rend pas plus de ${MAX_CONCURRENT_RENDERS} cartes à la fois`, async () => {
    let running = 0;
    let peak = 0;
    const slow = (key: string) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return new Response(key);
    };
    const keys = Array.from({ length: 8 }, (_, index) => `fr:team-${index}`);
    const images = await Promise.all(keys.map((key) => cachedShareImage(key, 60_000, slow(key), "team")));
    expect(peak).toBe(MAX_CONCURRENT_RENDERS);
    expect(images.every((image) => image !== null)).toBe(true);
  });

  it("libère sa place après un échec", async () => {
    const failing = jest.fn<() => Promise<Response | null>>().mockRejectedValue(new Error("satori"));
    for (let index = 0; index < MAX_CONCURRENT_RENDERS + 1; index += 1) {
      await expect(cachedShareImage(`fr:f${index}`, 1000, failing)).rejects.toThrow("satori");
    }
    expect(await cachedShareImage("fr:ok", 1000, png("ok"))).not.toBeNull();
  });

  it("borne le nombre de cartes fixes gardées (LRU)", async () => {
    const builds = new Map<string, jest.Mock<() => Promise<Response | null>>>();
    const build = (key: string) => {
      const fn = builds.get(key) ?? jest.fn(png(key));
      builds.set(key, fn);
      return fn;
    };
    await cachedShareImage("k0", 60_000, build("k0"));
    for (let index = 1; index <= SHARE_IMAGE_POOL_LIMITS.fixed; index += 1) {
      // k0 relue à chaque tour : la plus récente, jamais chassée.
      await cachedShareImage("k0", 60_000, build("k0"));
      await cachedShareImage(`k${index}`, 60_000, build(`k${index}`));
    }
    expect(builds.get("k0")).toHaveBeenCalledTimes(1);
    await cachedShareImage("k1", 60_000, build("k1"));
    expect(builds.get("k1")).toHaveBeenCalledTimes(2);
  });
});

describe("invalidateRankingShareImages", () => {
  it("invalidateRankingShareImages_cardFollowingRanking_rendersAgain", async () => {
    const build = jest.fn(png("podium"));
    await cachedShareImage("fr:podium", 60_000, build, "fixed", true);

    invalidateRankingShareImages();
    await cachedShareImage("fr:podium", 60_000, build, "fixed", true);

    expect(build).toHaveBeenCalledTimes(2);
  });

  it("invalidateRankingShareImages_teamPoolCard_rendersAgain", async () => {
    const build = jest.fn(png("team"));
    await cachedShareImage("fr:team:4", 60_000, build, "team", true);

    invalidateRankingShareImages();
    await cachedShareImage("fr:team:4", 60_000, build, "team", true);

    expect(build).toHaveBeenCalledTimes(2);
  });

  it("invalidateRankingShareImages_fixedCard_staysCached", async () => {
    const build = jest.fn(png("regles"));
    await cachedShareImage("fr:regles", 60_000, build);

    invalidateRankingShareImages();
    await cachedShareImage("fr:regles", 60_000, build);

    expect(build).toHaveBeenCalledTimes(1);
  });

  it("cachedShareImage_invalidatedDuringRender_servesButDoesNotStore", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const build = jest.fn(async () => {
      await gate;
      return png("ancien")();
    });
    const pending = cachedShareImage("fr:podium", 60_000, build, "fixed", true);
    await Promise.resolve();

    invalidateRankingShareImages();
    release();
    const served = await pending;
    const next = await cachedShareImage("fr:podium", 60_000, jest.fn(png("neuf")), "fixed", true);

    expect(Buffer.from(served!.body).toString("utf8")).toBe("ancien");
    expect(Buffer.from(next!.body).toString("utf8")).toBe("neuf");
  });
});

describe("cachedShareImage — garde des nouveaux rendus", () => {
  const admitting = (
    admit: () => boolean,
    overrides: Partial<ShareRenderAdmission> = {},
  ): ShareRenderAdmission => ({
    client: "203.0.113.1",
    admit,
    refund: () => undefined,
    maxQueued: MAX_QUEUED_EMBED_RENDERS,
    maxQueuedPerClient: MAX_QUEUED_EMBED_RENDERS_PER_CLIENT,
    ...overrides,
  });

  /** Rendus bloqués jusqu'à `drain` : occupent les places, puis la file. */
  function blocker() {
    const releases: Array<() => void> = [];
    const blocked = (key: string) => async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return new Response(key);
    };
    const drain = async () => {
      while (releases.length > 0 || queuedShareRenders() > 0) {
        releases.splice(0).forEach((release) => release());
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    return { blocked, drain };
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("cachedShareImage_waitedPastClientLimit_dropsNetworkKey", async () => {
    jest.useFakeTimers({ doNotFake: ["setImmediate"] });
    const { blocked, drain } = blocker();
    try {
      const pending = Array.from({ length: MAX_CONCURRENT_RENDERS + 1 }, (_, index) =>
        cachedShareImage(`k${index}`, 60_000, blocked(`k${index}`), "embed", false, admitting(() => true)),
      );
      await Promise.resolve();

      jest.advanceTimersByTime(MAX_RENDER_WAIT_CLIENT_MS);

      expect(queuedShareRenderClients()).toEqual([null]);
      jest.useRealTimers();
      await drain();
      await Promise.all(pending);
    } finally {
      jest.useRealTimers();
    }
  });

  it("cachedShareImage_waitingBeforeClientLimit_keepsNetworkKey", async () => {
    jest.useFakeTimers({ doNotFake: ["setImmediate"] });
    const { blocked, drain } = blocker();
    try {
      const pending = Array.from({ length: MAX_CONCURRENT_RENDERS + 1 }, (_, index) =>
        cachedShareImage(`k${index}`, 60_000, blocked(`k${index}`), "embed", false, admitting(() => true)),
      );
      await Promise.resolve();

      jest.advanceTimersByTime(MAX_RENDER_WAIT_CLIENT_MS - 1);

      expect(queuedShareRenderClients()).toEqual(["203.0.113.1"]);
      jest.useRealTimers();
      await drain();
      await Promise.all(pending);
    } finally {
      jest.useRealTimers();
    }
  });

  it("cachedShareImage_otherPoolQueueFull_stillAdmitsEmbed", async () => {
    const { blocked, drain } = blocker();
    const pending = Array.from({ length: MAX_CONCURRENT_RENDERS + MAX_QUEUED_EMBED_RENDERS }, (_, index) =>
      cachedShareImage(`fr:team-${index}`, 60_000, blocked(`t${index}`), "team"),
    );
    await tick();
    expect(queuedShareRenders("team")).toBe(MAX_QUEUED_EMBED_RENDERS);
    const admit = jest.fn(() => true);

    const embed = cachedShareImage("fr:match-1", 60_000, png("m"), "embed", false, admitting(admit));
    await tick();

    expect(admit).toHaveBeenCalledTimes(1);
    expect(queuedShareRenders("embed")).toBe(1);
    await drain();
    expect(await embed).not.toBeNull();
    await Promise.all(pending);
  });

  it("cachedShareImage_clientAlreadyHasTwoQueued_refusesWithoutToken", async () => {
    const { blocked, drain } = blocker();
    const running = Array.from({ length: MAX_CONCURRENT_RENDERS }, (_, index) =>
      cachedShareImage(`fr:run-${index}`, 60_000, blocked(`r${index}`), "embed"),
    );
    await tick();
    const queued = Array.from({ length: MAX_QUEUED_EMBED_RENDERS_PER_CLIENT }, (_, index) =>
      cachedShareImage(`fr:a-${index}`, 60_000, blocked(`a${index}`), "embed", false, admitting(() => true)),
    );
    await tick();
    const admit = jest.fn(() => true);

    const refused = await cachedShareImage("fr:a-extra", 60_000, png("x"), "embed", false, admitting(admit));

    expect(refused).toBeNull();
    expect(admit).not.toHaveBeenCalled();
    await drain();
    await Promise.all([...running, ...queued]);
  });

  it("cachedShareImage_otherClientWhileOneHasTwoQueued_isAdmitted", async () => {
    const { blocked, drain } = blocker();
    const running = Array.from({ length: MAX_CONCURRENT_RENDERS }, (_, index) =>
      cachedShareImage(`fr:run-${index}`, 60_000, blocked(`r${index}`), "embed"),
    );
    await tick();
    const queued = Array.from({ length: MAX_QUEUED_EMBED_RENDERS_PER_CLIENT }, (_, index) =>
      cachedShareImage(`fr:a-${index}`, 60_000, blocked(`a${index}`), "embed", false, admitting(() => true)),
    );
    await tick();
    const admit = jest.fn(() => true);

    const other = cachedShareImage("fr:b-1", 60_000, png("b"), "embed", false, admitting(admit, { client: "198.51.100.7" }));
    await tick();

    expect(admit).toHaveBeenCalledTimes(1);
    await drain();
    expect(await other).not.toBeNull();
    await Promise.all([...running, ...queued]);
  });

  it("cachedShareImage_buildReturnsNull_refundsToken", async () => {
    const refund = jest.fn();

    const image = await cachedShareImage("fr:gone", 60_000, async () => null, "embed", false, admitting(() => true, { refund }));

    expect(image).toBeNull();
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("cachedShareImage_buildThrows_doesNotRefund", async () => {
    const refund = jest.fn();
    const failing = async (): Promise<Response | null> => {
      throw new Error("satori");
    };

    await expect(cachedShareImage("fr:broken", 60_000, failing, "embed", false, admitting(() => true, { refund }))).rejects.toThrow("satori");

    expect(refund).not.toHaveBeenCalled();
  });

  it("cachedShareImage_admissionRefuses_returnsNullWithoutBuild", async () => {
    const build = jest.fn(png("a"));

    const image = await cachedShareImage("fr:t-1", 1000, build, "embed", false, admitting(() => false));

    expect(image).toBeNull();
    expect(build).not.toHaveBeenCalled();
  });

  it("cachedShareImage_hitInMemory_neverCallsAdmit", async () => {
    await cachedShareImage("fr:t-1", 60_000, png("a"), "embed");
    const admit = jest.fn(() => false);

    const image = await cachedShareImage("fr:t-1", 60_000, png("b"), "embed", false, admitting(admit));

    expect(image).not.toBeNull();
    expect(admit).not.toHaveBeenCalled();
  });

  it("cachedShareImage_joiningInFlight_neverCallsAdmit", async () => {
    let finish: () => void = () => undefined;
    const slow = async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return new Response("a");
    };
    const first = cachedShareImage("fr:t-1", 60_000, slow, "embed", false, admitting(() => true));
    await Promise.resolve();
    const admit = jest.fn(() => false);
    const joiner = cachedShareImage("fr:t-1", 60_000, slow, "embed", false, admitting(admit));
    finish();

    expect(await joiner).not.toBeNull();
    expect(await first).not.toBeNull();
    expect(admit).not.toHaveBeenCalled();
  });

  it("cachedShareImage_queueFull_refusesWithoutTakingToken", async () => {
    const { blocked, drain } = blocker();
    const pending = Array.from({ length: MAX_CONCURRENT_RENDERS + MAX_QUEUED_EMBED_RENDERS }, (_, index) =>
      cachedShareImage(`fr:busy-${index}`, 60_000, blocked(`b${index}`), "embed"),
    );
    await tick();
    expect(queuedShareRenders()).toBe(MAX_QUEUED_EMBED_RENDERS);
    const admit = jest.fn(() => true);

    const refused = await cachedShareImage("fr:extra", 60_000, png("x"), "embed", false, admitting(admit));

    expect(refused).toBeNull();
    expect(admit).not.toHaveBeenCalled();
    await drain();
    await Promise.all(pending);
  });
});
