import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { cached, clearCache } from "@/lib/server/cache";
import {
  LANDING_TTL_MS,
  cachedLanding,
  invalidateLandingAggregates,
} from "@/lib/server/landing-cache";

/**
 * Le test des notifications vérifie que l'invalidateur est *appelé* ; celui-ci
 * vérifie qu'il **atteint** bien les entrées de la vitrine. Les deux moitiés
 * sont nécessaires : un préfixe qui divergerait entre l'écriture et
 * l'effacement laisserait l'appel se faire dans le vide.
 */
describe("cache de la vitrine", () => {
  beforeEach(() => clearCache());
  afterEach(() => clearCache());

  it("mutualise les lectures d'une même clé", async () => {
    const loader = jest.fn(async () => "valeur");

    await cachedLanding("stats", LANDING_TTL_MS, loader as () => Promise<string>);
    const second = await cachedLanding("stats", LANDING_TTL_MS, loader as () => Promise<string>);

    expect(second).toBe("valeur");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it.each(["stats", "live", "ticker", "leaderboard:10"])(
    "oublie l'entrée « %s » à l'invalidation",
    async (key) => {
      const loader = jest.fn(async () => "valeur");
      await cachedLanding(key, LANDING_TTL_MS, loader as () => Promise<string>);

      invalidateLandingAggregates();
      await cachedLanding(key, LANDING_TTL_MS, loader as () => Promise<string>);

      expect(loader).toHaveBeenCalledTimes(2);
    },
  );

  it("range ses entrées sous un préfixe qui lui est propre", async () => {
    // Sans préfixe distinct, invalider la vitrine emporterait les instantanés
    // de tournoi et les listes, et le cache le plus rentable du site
    // repartirait de zéro à chaque écriture.
    const voisin = jest.fn(async () => "intact");
    await cached("tournaments-list:all", LANDING_TTL_MS, voisin as () => Promise<string>);

    invalidateLandingAggregates();
    await cached("tournaments-list:all", LANDING_TTL_MS, voisin as () => Promise<string>);

    expect(voisin).toHaveBeenCalledTimes(1);
  });
});
