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
import { listAboutStats } from "@/lib/server/about-stats-service";
import { getCurrentUser } from "@/lib/server/auth";
import { getSiteCopy } from "@/lib/server/site-copy-service";
import { can } from "@/lib/shared/permissions";
import { loadMiniBracket } from "@/lib/server/tournaments/bracket-loader";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";

export const dynamic = "force-dynamic";

function chooseNextTournament(buckets: TournamentBuckets): TournamentCard | null {
  return buckets.upcoming[0] ?? buckets.registration[0] ?? buckets.running[0] ?? buckets.finished[0] ?? null;
}

export default async function HomePage() {
  const buckets = await listTournamentBuckets(null).catch(() => ({
    upcoming: [],
    registration: [],
    running: [],
    finished: [],
  }));

  const featured = chooseNextTournament(buckets);
  const [stats, live, leaderboard, events, ticker, sponsors, aboutStats, miniBracket, user, copy] = await Promise.all([
    getLandingStats(),
    getLandingLive(buckets),
    getLandingLeaderboard(),
    getLandingCalendar(buckets, 5),
    getLandingTicker(),
    listSponsors().catch(() => []),
    listAboutStats(),
    featured ? loadMiniBracket(featured.id) : Promise.resolve([]),
    getCurrentUser().catch(() => null),
    getSiteCopy(),
  ]);
  // Gestion du site vitrine : administrateurs + Community Managers.
  const isAdmin = can(user, "showcase");

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />
      <Hero stats={stats} live={live} nextUpcoming={featured} copy={copy} canEditCopy={isAdmin} />
      <Ticker items={ticker.items} />
      <TournamentBoard buckets={buckets} featured={featured} miniBracket={miniBracket} />
      <LeaderCal leaderboard={leaderboard} events={events} />
      <AboutSection stats={aboutStats} isAdmin={isAdmin} copy={copy} />
      <SponsorsGrid sponsors={sponsors} isAdmin={isAdmin} />
      <JoinCTA isAuthenticated={!!user} copy={copy} canEditCopy={isAdmin} />
      <PublicFooter />
    </main>
  );
}
