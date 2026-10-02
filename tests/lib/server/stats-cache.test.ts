import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { cached, clearCache } from "@/lib/server/cache";
import { STATS_TTL_MS, cachedStats, invalidateStats } from "@/lib/server/stats-cache";

/**
 * Le cache des statistiques existe pour qu'un F5 maintenu sur l'annuaire ou sur
 * une fiche ne relance pas l'agrégat complet à chaque chargement. Trois
 * propriétés le tiennent : une valeur fraîche est resservie, des lecteurs
 * simultanés partagent un seul calcul, et l'invalidation n'oublie que les
 * statistiques.
 */
describe("stats-cache", () => {
  beforeEach(() => {
    clearCache();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    clearCache();
  });

  it("resert la valeur tant qu'elle est fraîche", async () => {
    const loader = jest.fn(async () => ({ wins: 3 }));

    await cachedStats("team:5", loader);
    await cachedStats("team:5", loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("recalcule une fois la durée de vie écoulée", async () => {
    const loader = jest.fn(async () => ({ wins: 3 }));

    await cachedStats("team:5", loader);
    jest.advanceTimersByTime(STATS_TTL_MS + 1);
    await cachedStats("team:5", loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("fait partager un seul calcul aux lecteurs simultanés", async () => {
    let release: (value: number) => void = (_value) => undefined;
    const loader = jest.fn(() => new Promise<number>((resolve) => (release = resolve)));

    const reads = Array.from({ length: 20 }, () => cachedStats("player-records", loader));
    release(7);

    expect(await Promise.all(reads)).toEqual(Array(20).fill(7));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("sépare les clés : une équipe ne resert pas le bilan d'une autre", async () => {
    const loader = jest.fn(async (id: number) => id);

    expect(await cachedStats("team:5", () => loader(5))).toBe(5);
    expect(await cachedStats("team:6", () => loader(6))).toBe(6);
    expect(await cachedStats("player:5", () => loader(50))).toBe(50);
  });

  it("oublie toutes les statistiques à l'invalidation", async () => {
    const loader = jest.fn(async () => 1);
    await cachedStats("team:5", loader);
    await cachedStats("player-records", loader);

    invalidateStats();
    await cachedStats("team:5", loader);
    await cachedStats("player-records", loader);

    expect(loader).toHaveBeenCalledTimes(4);
  });

  it("n'oublie que les statistiques : les autres caches restent chauds", async () => {
    const other = jest.fn(async () => "landing");
    await cached("landing:stats", 60_000, other);

    invalidateStats();
    await cached("landing:stats", 60_000, other);

    expect(other).toHaveBeenCalledTimes(1);
  });

  it("ne garde pas un échec : la lecture suivante retente", async () => {
    const loader = jest
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("pool épuisé"))
      .mockResolvedValueOnce(4);

    await expect(cachedStats("team:5", loader)).rejects.toThrow("pool épuisé");
    await expect(cachedStats("team:5", loader)).resolves.toBe(4);
  });
});
