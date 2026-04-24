import { PageWithPalette } from "@/components/page-with-palette";
import { Ticker } from "@/components/cyber";
import { AboutSection } from "@/components/cyber/landing/AboutSection";
import { Hero } from "@/components/cyber/landing/Hero";
import { JoinCTA } from "@/components/cyber/landing/JoinCTA";
import { LeaderCal } from "@/components/cyber/landing/LeaderCal";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { SponsorsGrid } from "@/components/cyber/landing/SponsorsGrid";
import { TournamentBoard } from "@/components/cyber/landing/TournamentBoard";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import { listSponsors } from "@/lib/server/sponsors-service";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import type {
  LandingCalendarEvent,
  LandingLeaderboardRow,
  LandingLive,
  LandingStats,
  LandingTickerPayload,
} from "@/lib/shared/landing";
import { inferGameLabel, inferPhaseLabel } from "@/lib/shared/landing";

export const revalidate = 60;
export const dynamic = "force-dynamic";

const APP_URL = process.env.APP_URL?.trim() || "http://localhost:3000";

const DEFAULT_STATS: LandingStats = {
  players: 0,
  teams: 0,
  tournaments: 0,
};

const DEFAULT_TICKER: LandingTickerPayload = {
  items: [
    "RÉSULTAT · En attente de nouveaux matches",
    "INSCRIPTIONS · Prochains brackets à venir",
    "COMMUNAUTÉ · Rejoindre le Discord BlueGenji",
  ],
};

type LandingBuckets = TournamentBuckets;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function normalizeLive(payload: { live: LandingLive | null } | null): LandingLive | null {
  const live = payload?.live ?? null;
  if (!live) {
    return null;
  }

  return {
    ...live,
    game: inferGameLabel(live.tournament.name),
    phase: inferPhaseLabel(live.currentMatch),
  };
}

function chooseNextTournament(buckets: LandingBuckets): TournamentCard | null {
  return buckets.upcoming[0] ?? buckets.registration[0] ?? buckets.running[0] ?? buckets.finished[0] ?? null;
}

export default async function HomePage() {
  const [statsRes, liveRes, leaderboardRes, calendarRes, tickerRes, bucketsRes, sponsors] = await Promise.all([
    fetchJson<LandingStats>(`${APP_URL}/api/landing/stats`, { next: { revalidate: 60 } }),
    fetchJson<{ live: LandingLive | null }>(`${APP_URL}/api/landing/live`, { cache: "no-store" }),
    fetchJson<{ leaderboard: LandingLeaderboardRow[] }>(`${APP_URL}/api/landing/leaderboard`, { next: { revalidate: 300 } }),
    fetchJson<{ events: LandingCalendarEvent[] }>(`${APP_URL}/api/landing/calendar`, { next: { revalidate: 300 } }),
    fetchJson<LandingTickerPayload>(`${APP_URL}/api/landing/ticker`, { next: { revalidate: 60 } }),
    listTournamentBuckets(null).catch(() => ({
      upcoming: [],
      registration: [],
      running: [],
      finished: [],
    })),
    listSponsors().catch(() => []),
  ]);

  const stats = statsRes ?? DEFAULT_STATS;
  const live = normalizeLive(liveRes);
  const leaderboard = leaderboardRes?.leaderboard ?? [];
  const events = calendarRes?.events ?? [];
  const ticker = tickerRes ?? DEFAULT_TICKER;
  const buckets = bucketsRes;
  const nextUpcoming = chooseNextTournament(buckets);

  return (
    <PageWithPalette palette="blue">
      <main style={{ position: "relative", zIndex: 1 }}>
        <PublicHeader />
        <Hero stats={stats} live={live} nextUpcoming={nextUpcoming} />
        <Ticker items={ticker.items} />
        <TournamentBoard buckets={buckets} />
        <LeaderCal leaderboard={leaderboard} events={events} />
        <AboutSection />
        <SponsorsGrid sponsors={sponsors} />
        <JoinCTA />
        <PublicFooter />
      </main>
    </PageWithPalette>
  );
}
