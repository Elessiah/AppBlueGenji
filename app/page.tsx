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
import {
  getLandingCalendar,
  getLandingLeaderboard,
  getLandingLive,
  getLandingStats,
  getLandingTicker,
} from "@/lib/server/landing-service";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import { listSponsors } from "@/lib/server/sponsors-service";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";

export const dynamic = "force-dynamic";

function chooseNextTournament(buckets: TournamentBuckets): TournamentCard | null {
  return buckets.upcoming[0] ?? buckets.registration[0] ?? buckets.running[0] ?? buckets.finished[0] ?? null;
}

export default async function HomePage() {
  const [stats, live, leaderboard, events, ticker, buckets, sponsors] = await Promise.all([
    getLandingStats(),
    getLandingLive(),
    getLandingLeaderboard(),
    getLandingCalendar(),
    getLandingTicker(),
    listTournamentBuckets(null).catch(() => ({
      upcoming: [],
      registration: [],
      running: [],
      finished: [],
    })),
    listSponsors().catch(() => []),
  ]);

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
