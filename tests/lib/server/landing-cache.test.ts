import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { cached, clearCache } from "@/lib/server/cache";
import {
  LANDING_TTL_MS,
  cachedLanding,
  LANDING_LIVE_KEY,
  LANDING_TICKER_KEY,
  LANDING_STATS_KEY,
  LANDING_MINI_BRACKET_KEY_PREFIX,
  invalidateLandingLeaderboards,
  invalidateLandingAggregates,
  invalidateLandingTeamViews,
  invalidateLandingLive,
  invalidateLandingCounters,
} from "@/lib/server/landing-cache";

/**
 * Le test des notifications vérifie que l'invalidateur est *appelé* ; celui-ci
 * vérifie qu'il **atteint** bien les entrées de la vitrine. Les deux moitiés
 * sont nécessaires : un préfixe qui divergerait entre l'écriture et
 * l'effacement laisserait l'appel se faire dans le vide.
 */
describe("cache de la vitrine", () => {
  beforeEach(() => {
    clearCache();
  });
  afterEach(() => {
    clearCache();
  });

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

  // Le test des notifications vérifie que l'invalidateur du direct est appelé ;
  // celui-ci qu'il atteint bien l'entrée que `getLandingLive` écrit.
  it("oublie le direct à l'invalidation du direct", async () => {
    const loader = jest.fn(async () => "valeur");
    await cachedLanding(LANDING_LIVE_KEY, LANDING_TTL_MS, loader as () => Promise<string>);

    invalidateLandingLive();
    await cachedLanding(LANDING_LIVE_KEY, LANDING_TTL_MS, loader as () => Promise<string>);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("laisse le reste de la vitrine en place à l'invalidation du direct", async () => {
    // Un réglage d'antenne ne doit pas relancer compteurs, classement et ticker.
    const loader = jest.fn(async () => "valeur");
    await cachedLanding("stats", LANDING_TTL_MS, loader as () => Promise<string>);

    invalidateLandingLive();
    await cachedLanding("stats", LANDING_TTL_MS, loader as () => Promise<string>);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("oublie chaque leaderboard, par jeu compris, à l'invalidation des vues d'équipes", async () => {
    const loader = jest.fn(async () => "valeur");
    const keys = ["leaderboard:8:all", "leaderboard:50:MARVEL_RIVALS"];
    for (const key of keys) await cachedLanding(key, LANDING_TTL_MS, loader as () => Promise<string>);

    invalidateLandingTeamViews();
    for (const key of keys) await cachedLanding(key, LANDING_TTL_MS, loader as () => Promise<string>);

    expect(loader).toHaveBeenCalledTimes(4);
  });

  it("oublie le bandeau, qui nomme des équipes, à l'invalidation des vues d'équipes", async () => {
    const loader = jest.fn(async () => "valeur");
    await cachedLanding(LANDING_TICKER_KEY, LANDING_TTL_MS, loader as () => Promise<string>);

    invalidateLandingTeamViews();
    await cachedLanding(LANDING_TICKER_KEY, LANDING_TTL_MS, loader as () => Promise<string>);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("garde l'entrée « live » à l'invalidation des vues d'équipes", async () => {
    // Le direct vit 5 s : une dissolution ne change aucun match.
    const loader = jest.fn(async () => "valeur");
    await cachedLanding("live", LANDING_TTL_MS, loader as () => Promise<string>);

    invalidateLandingTeamViews();
    await cachedLanding("live", LANDING_TTL_MS, loader as () => Promise<string>);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("invalidateLandingTeamViews_cachedStats_reloadsActiveTeamCount", async () => {
    // « Équipes actives » filtre `deleted_at` : une dissolution doit le vider.
    const loader = jest.fn(async () => "valeur");
    await cachedLanding(LANDING_STATS_KEY, LANDING_TTL_MS, loader as () => Promise<string>);

    invalidateLandingTeamViews();
    await cachedLanding(LANDING_STATS_KEY, LANDING_TTL_MS, loader as () => Promise<string>);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidateLandingTeamViews_cachedMiniBracket_reloadsTeamNames", async () => {
    const loader = jest.fn(async () => "valeur");
    await cachedLanding(`${LANDING_MINI_BRACKET_KEY_PREFIX}7`, LANDING_TTL_MS, loader as () => Promise<string>);

    invalidateLandingTeamViews();
    await cachedLanding(`${LANDING_MINI_BRACKET_KEY_PREFIX}7`, LANDING_TTL_MS, loader as () => Promise<string>);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidateLandingAggregates_cachedMiniBracket_reloadsAfterScore", async () => {
    // Clé sous le préfixe `landing:` : un score la vide avec le reste de l'accueil.
    const loader = jest.fn(async () => "valeur");
    await cachedLanding(`${LANDING_MINI_BRACKET_KEY_PREFIX}7`, LANDING_TTL_MS, loader as () => Promise<string>);

    invalidateLandingAggregates();
    await cachedLanding(`${LANDING_MINI_BRACKET_KEY_PREFIX}7`, LANDING_TTL_MS, loader as () => Promise<string>);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidateLandingLeaderboards_cachedLeaderboardAndStats_reloadsLeaderboardOnly", async () => {
    const leaderboard = jest.fn(async () => "rangs");
    const stats = jest.fn(async () => "compteurs");
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, leaderboard as () => Promise<string>);
    await cachedLanding(LANDING_STATS_KEY, LANDING_TTL_MS, stats as () => Promise<string>);

    invalidateLandingLeaderboards();
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, leaderboard as () => Promise<string>);
    await cachedLanding(LANDING_STATS_KEY, LANDING_TTL_MS, stats as () => Promise<string>);

    expect(leaderboard).toHaveBeenCalledTimes(2);
    expect(stats).toHaveBeenCalledTimes(1);
  });

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

describe("invalidateLandingCounters", () => {
  beforeEach(() => {
    clearCache();
  });
  afterEach(() => {
    clearCache();
  });

  it("invalidateLandingCounters_cachedStats_reloadsCounters", async () => {
    const loader = jest.fn(async () => "compteurs");
    await cachedLanding(LANDING_STATS_KEY, LANDING_TTL_MS, loader);

    invalidateLandingCounters();
    await cachedLanding(LANDING_STATS_KEY, LANDING_TTL_MS, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidateLandingCounters_cachedTickerAndMiniBracket_keepsThem", async () => {
    // Une équipe jamais inscrite n'est ni au bandeau ni à un mini-arbre.
    const loader = jest.fn(async () => "vue");
    await cachedLanding(LANDING_TICKER_KEY, LANDING_TTL_MS, loader);
    await cachedLanding(`${LANDING_MINI_BRACKET_KEY_PREFIX}4`, LANDING_TTL_MS, loader);

    invalidateLandingCounters();
    await cachedLanding(LANDING_TICKER_KEY, LANDING_TTL_MS, loader);
    await cachedLanding(`${LANDING_MINI_BRACKET_KEY_PREFIX}4`, LANDING_TTL_MS, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });
});
