import { describe, expect, it } from "@jest/globals";
import {
  FOCUS_REFRESH_MIN_INTERVAL_MS,
  LANDING_LIVE_INTERVAL_MS,
  REFRESH_CADENCE,
  isRefreshTier,
  refreshCadenceFor,
  resolveRefreshTier,
} from "@/lib/shared/refresh-tiers";

describe("refresh-tiers — résolution du palier", () => {
  it("place le staff tournois en prioritaire", () => {
    expect(resolveRefreshTier({ isStaff: true })).toBe("PRIORITY");
  });

  it("place un engagé du tournoi en prioritaire", () => {
    expect(resolveRefreshTier({ isParticipant: true })).toBe("PRIORITY");
  });

  it("laisse le spectateur en palier standard", () => {
    expect(resolveRefreshTier({ isStaff: false, isParticipant: false })).toBe("STANDARD");
    expect(resolveRefreshTier({})).toBe("STANDARD");
  });

  it("retombe sur le palier standard sans information", () => {
    // Une entrée absente ne doit jamais octroyer le palier rapide par accident.
    expect(resolveRefreshTier(null)).toBe("STANDARD");
    expect(resolveRefreshTier(undefined)).toBe("STANDARD");
  });

  it("expose les cadences du palier résolu", () => {
    expect(refreshCadenceFor({ isStaff: true })).toBe(REFRESH_CADENCE.PRIORITY);
    expect(refreshCadenceFor(null)).toBe(REFRESH_CADENCE.STANDARD);
  });
});

describe("refresh-tiers — cohérence des cadences", () => {
  it("sert toujours le palier prioritaire plus vite", () => {
    const priority = REFRESH_CADENCE.PRIORITY;
    const standard = REFRESH_CADENCE.STANDARD;

    expect(priority.pushCoalesceMs).toBeLessThan(standard.pushCoalesceMs);
    expect(priority.detailFallbackMs).toBeLessThan(standard.detailFallbackMs);
    expect(priority.listIntervalMs).toBeLessThan(standard.listIntervalMs);
  });

  it("garde hors de la table ce qui ne dépend d'aucun palier", () => {
    // L'accueil est public et anonyme : il n'y a personne dont résoudre le
    // palier. Une entrée `landingLiveMs` par palier laisserait croire qu'on peut
    // servir le staff plus vite — on changerait le nombre sans rien observer.
    for (const cadence of Object.values(REFRESH_CADENCE)) {
      expect(cadence).not.toHaveProperty("landingLiveMs");
    }
    expect(LANDING_LIVE_INTERVAL_MS).toBeGreaterThanOrEqual(300_000);
  });

  it("garde le spectateur dans la fenêtre de 5 à 10 minutes demandée", () => {
    expect(REFRESH_CADENCE.STANDARD.listIntervalMs).toBeGreaterThanOrEqual(300_000);
    expect(REFRESH_CADENCE.STANDARD.listIntervalMs).toBeLessThanOrEqual(600_000);
    expect(LANDING_LIVE_INTERVAL_MS).toBeLessThanOrEqual(600_000);
  });

  it("n'accepte aucune cadence nulle ou négative", () => {
    // Une cadence nulle désarmerait le sondage de secours, ou ferait tourner un
    // minuteur en boucle serrée.
    for (const cadence of Object.values(REFRESH_CADENCE)) {
      for (const value of Object.values(cadence)) {
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it("étrangle le rafraîchissement par retour d'onglet", () => {
    expect(FOCUS_REFRESH_MIN_INTERVAL_MS).toBeGreaterThan(0);
  });
});

describe("refresh-tiers — validation d'un palier reçu du réseau", () => {
  it("accepte les paliers connus", () => {
    expect(isRefreshTier("PRIORITY")).toBe(true);
    expect(isRefreshTier("STANDARD")).toBe(true);
  });

  it("rejette tout le reste", () => {
    expect(isRefreshTier("ADMIN")).toBe(false);
    expect(isRefreshTier("priority")).toBe(false);
    expect(isRefreshTier(null)).toBe(false);
    expect(isRefreshTier(undefined)).toBe(false);
    expect(isRefreshTier(1)).toBe(false);
    expect(isRefreshTier({})).toBe(false);
  });
});
