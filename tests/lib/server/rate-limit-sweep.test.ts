import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { SHARE_EMBED_RENDER_RULE, SPECTATOR_READ_RULE, SPECTATOR_REBUILD_RULE } from "@/lib/server/api-guard";
import {
  RATE_LIMIT_SWEEP_INTERVAL_MS,
  armRateLimitSweepTimer,
  disarmRateLimitSweepTimer,
  chargeRateLimit,
  checkRateLimit,
  resetRateLimit,
  sweepSpentRateKeys,
  takeTokenBucket,
  trackedRateKeyCount,
  type RateLimitRule,
  type TokenBucketRule,
} from "@/lib/server/rate-limit";

/**
 * Le registre (T03) promet qu'une adresse IP de visiteur sans compte ne reste
 * en mémoire que deux minutes au plus : une clé épuisée (fenêtre close, seau
 * plein) est effacée par un balayage périodique, sans rien changer aux plafonds.
 */
const WINDOW: RateLimitRule = { name: "sweep-window", limit: 5, windowMs: 60_000 };
const BUCKET: TokenBucketRule = { name: "sweep-bucket", capacity: 2, refillMs: 10_000 };

afterEach(() => {
  resetRateLimit();
});

describe("balayage des clés épuisées", () => {
  it("efface un compteur dont la fenêtre est close, et la clé repart à neuf", () => {
    chargeRateLimit(WINDOW, "203.0.113.7", 0);

    sweepSpentRateKeys(60_000);

    expect(trackedRateKeyCount(WINDOW.name)).toBe(0);
    expect(checkRateLimit(WINDOW, "203.0.113.7", 60_001).remaining).toBe(5);
  });

  it("garde un compteur dont la fenêtre est ouverte, avec son décompte", () => {
    chargeRateLimit(WINDOW, "203.0.113.7", 0);
    chargeRateLimit(WINDOW, "203.0.113.7", 0);

    sweepSpentRateKeys(30_000);

    expect(trackedRateKeyCount(WINDOW.name)).toBe(1);
    expect(checkRateLimit(WINDOW, "203.0.113.7", 30_000).remaining).toBe(3);
  });

  it("efface un seau de jetons revenu plein", () => {
    takeTokenBucket(BUCKET, "2001:db8::/64", 0);

    sweepSpentRateKeys(10_000);

    expect(trackedRateKeyCount(BUCKET.name)).toBe(0);
  });

  it("garde un seau entamé : le plafond tient toujours", () => {
    takeTokenBucket(BUCKET, "2001:db8::/64", 0);
    takeTokenBucket(BUCKET, "2001:db8::/64", 0);

    sweepSpentRateKeys(5_000);

    expect(trackedRateKeyCount(BUCKET.name)).toBe(1);
    expect(takeTokenBucket(BUCKET, "2001:db8::/64", 5_000).allowed).toBe(false);
  });

  it("balaie de lui-même à la prochaine prise, une fois l'intervalle passé", () => {
    takeTokenBucket(BUCKET, "198.51.100.1", 0);

    takeTokenBucket(BUCKET, "198.51.100.2", RATE_LIMIT_SWEEP_INTERVAL_MS);

    expect(trackedRateKeyCount(BUCKET.name)).toBe(1);
  });

  it("ne balaie pas avant l'intervalle", () => {
    takeTokenBucket(BUCKET, "198.51.100.1", 0);

    takeTokenBucket(BUCKET, "198.51.100.2", 20_000);

    expect(trackedRateKeyCount(BUCKET.name)).toBe(2);
  });
});

describe("minuteur détaché du balayage (processus au repos)", () => {
  afterEach(() => {
    disarmRateLimitSweepTimer();
    jest.useRealTimers();
  });

  it("efface une clé épuisée sans qu'aucune requête n'arrive", () => {
    jest.useFakeTimers();
    armRateLimitSweepTimer();
    chargeRateLimit(WINDOW, "203.0.113.7", Date.now());

    jest.advanceTimersByTime(WINDOW.windowMs + RATE_LIMIT_SWEEP_INTERVAL_MS);

    expect(trackedRateKeyCount(WINDOW.name)).toBe(0);
  });

  it("garde une clé dont la fenêtre est encore ouverte", () => {
    jest.useFakeTimers();
    armRateLimitSweepTimer();
    chargeRateLimit(WINDOW, "203.0.113.7", Date.now());

    jest.advanceTimersByTime(RATE_LIMIT_SWEEP_INTERVAL_MS);

    expect(trackedRateKeyCount(WINDOW.name)).toBe(1);
  });

  it("armé, le minuteur seul balaie : une requête ne paie pas le parcours", () => {
    jest.useFakeTimers();
    armRateLimitSweepTimer();
    takeTokenBucket(BUCKET, "198.51.100.1", 0);

    takeTokenBucket(BUCKET, "198.51.100.2", RATE_LIMIT_SWEEP_INTERVAL_MS);

    expect(trackedRateKeyCount(BUCKET.name)).toBe(2);
  });

  it("désarmé, il ne balaie plus", () => {
    jest.useFakeTimers();
    armRateLimitSweepTimer();
    chargeRateLimit(WINDOW, "203.0.113.7", Date.now());
    disarmRateLimitSweepTimer();

    jest.advanceTimersByTime(WINDOW.windowMs + RATE_LIMIT_SWEEP_INTERVAL_MS);

    expect(trackedRateKeyCount(WINDOW.name)).toBe(1);
  });
});

describe("durée déclarée au registre", () => {
  const TWO_MINUTES = 120_000;

  it("le plafond de lecture de la page sans compte se remet à zéro en deux minutes au plus", () => {
    expect(SPECTATOR_READ_RULE.windowMs + RATE_LIMIT_SWEEP_INTERVAL_MS).toBeLessThanOrEqual(TWO_MINUTES);
  });

  it("le plafond de reconstruction se remet à zéro en deux minutes au plus", () => {
    expect(SPECTATOR_REBUILD_RULE.capacity * SPECTATOR_REBUILD_RULE.refillMs + RATE_LIMIT_SWEEP_INTERVAL_MS)
      .toBeLessThanOrEqual(TWO_MINUTES);
  });

  it("le plafond des images d'aperçu se remet à zéro en deux minutes au plus", () => {
    expect(SHARE_EMBED_RENDER_RULE.capacity * SHARE_EMBED_RENDER_RULE.refillMs + RATE_LIMIT_SWEEP_INTERVAL_MS)
      .toBeLessThanOrEqual(TWO_MINUTES);
  });
});
