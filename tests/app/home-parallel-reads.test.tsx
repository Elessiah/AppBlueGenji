import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { TournamentBuckets } from "@/lib/shared/types";

/**
 * L'accueil n'attend plus les tournois avant ses autres lectures : seuls le
 * calendrier et le mini-tableau en dépendent. Les autres partent en même temps,
 * sans quoi le premier rendu après une invalidation payait les tournois, puis
 * la plus lente des autres (revue performance EF-01, #479).
 */
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => "fr" }));
jest.mock("@/lib/server/auth", () => ({ getCurrentUser: jest.fn(async () => null) }));
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://bluegenji.test" }));
jest.mock("@/lib/server/sponsors-service", () => ({ listSponsors: jest.fn(async () => []) }));
jest.mock("@/lib/server/about-stats-service", () => ({ listAboutStats: jest.fn(async () => []) }));
jest.mock("@/lib/server/about-pillars-service", () => ({ listAboutPillars: jest.fn(async () => []) }));
jest.mock("@/lib/server/tournaments/bracket-loader", () => ({ loadMiniBracket: jest.fn(async () => []) }));
jest.mock("@/lib/server/site-copy-service", () => {
  const { resolveSiteCopy } = jest.requireActual<typeof import("@/lib/shared/site-copy")>("@/lib/shared/site-copy");
  return { getSiteCopyBundle: jest.fn(async () => resolveSiteCopy(new Map())) };
});
jest.mock("@/lib/server/tournaments-service", () => ({ listTournamentBuckets: jest.fn() }));
jest.mock("@/lib/server/landing-service", () => ({
  getLandingStats: jest.fn(async () => ({ players: 0, teams: 0, tournaments: 0, discord: null })),
  getLandingLive: jest.fn(async () => null),
  getLandingLeaderboard: jest.fn(async () => []),
  getLandingCalendar: jest.fn(async () => []),
  getLandingTicker: jest.fn(async () => ({ items: [] })),
}));

import HomePage from "@/app/page";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import { loadMiniBracket } from "@/lib/server/tournaments/bracket-loader";
import { getSiteCopyBundle } from "@/lib/server/site-copy-service";
import {
  getLandingCalendar,
  getLandingLeaderboard,
  getLandingLive,
  getLandingStats,
  getLandingTicker,
} from "@/lib/server/landing-service";
import { tournamentCard } from "../helpers/tournament-card";

const EMPTY: TournamentBuckets = { upcoming: [], registration: [], running: [], finished: [] };

function deferredBuckets(): { resolve: (value: TournamentBuckets) => void; reject: (error: Error) => void } {
  let resolve: (value: TournamentBuckets) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const pending = new Promise<TournamentBuckets>((ok, ko) => {
    resolve = ok;
    reject = ko;
  });
  jest.mocked(listTournamentBuckets).mockReturnValueOnce(pending);
  return { resolve, reject };
}

/** Laisse passer les micro-tâches : `requestLocale`, puis le départ des lectures. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("accueil — lectures en parallèle", () => {
  it("les lectures indépendantes des tournois partent avant leur réponse", async () => {
    const buckets = deferredBuckets();
    const page = HomePage();
    await flush();

    expect(listTournamentBuckets).toHaveBeenCalledWith(null);
    expect(getLandingStats).toHaveBeenCalledTimes(1);
    expect(getLandingLive).toHaveBeenCalledTimes(1);
    expect(getLandingLeaderboard).toHaveBeenCalledTimes(1);
    expect(getLandingTicker).toHaveBeenCalledWith("fr");
    expect(getSiteCopyBundle).toHaveBeenCalledTimes(1);
    // Le calendrier et le mini-tableau, eux, attendent les tournois.
    expect(getLandingCalendar).not.toHaveBeenCalled();
    expect(loadMiniBracket).not.toHaveBeenCalled();

    const running = tournamentCard({ id: 3, name: "Gamma League", state: "RUNNING", startAt: new Date().toISOString() });
    const loaded: TournamentBuckets = { ...EMPTY, running: [running] };
    buckets.resolve(loaded);
    await page;

    expect(getLandingCalendar).toHaveBeenCalledWith(loaded, 5);
    expect(loadMiniBracket).toHaveBeenCalledWith(3, "fr");
  });

  it("sans tournoi à la une, aucun mini-tableau n'est chargé", async () => {
    const buckets = deferredBuckets();
    const page = HomePage();
    buckets.resolve(EMPTY);
    await page;

    expect(getLandingCalendar).toHaveBeenCalledWith(EMPTY, 5);
    expect(loadMiniBracket).not.toHaveBeenCalled();
  });

  it("tournois injoignables : l'accueil se rend avec des listes vides", async () => {
    const buckets = deferredBuckets();
    const page = HomePage();
    buckets.reject(new Error("base injoignable"));

    await expect(page).resolves.toBeTruthy();
    expect(getLandingCalendar).toHaveBeenCalledWith(EMPTY, 5);
    expect(loadMiniBracket).not.toHaveBeenCalled();
    expect(getLandingStats).toHaveBeenCalledTimes(1);
  });
});
