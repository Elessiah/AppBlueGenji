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
import { chooseFeaturedTournament } from "@/lib/shared/landing";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import { listSponsors } from "@/lib/server/sponsors-service";
import { listAboutStats } from "@/lib/server/about-stats-service";
import { listAboutPillars } from "@/lib/server/about-pillars-service";
import { getCurrentUser } from "@/lib/server/auth";
import { getSiteCopy } from "@/lib/server/site-copy-service";
import { can } from "@/lib/shared/permissions";
import { loadMiniBracket } from "@/lib/server/tournaments/bracket-loader";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const buckets = await listTournamentBuckets(null).catch(() => ({
    upcoming: [],
    registration: [],
    running: [],
    finished: [],
  }));

  const featured = chooseFeaturedTournament(buckets);
  const [stats, live, leaderboard, events, ticker, sponsors, aboutStats, aboutPillars, miniBracket, user, copy] =
    await Promise.all([
      getLandingStats(),
      getLandingLive(),
      getLandingLeaderboard(),
      getLandingCalendar(buckets, 5),
      getLandingTicker(),
      listSponsors().catch(() => []),
      listAboutStats(),
      listAboutPillars(),
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
      <AboutSection stats={aboutStats} pillars={aboutPillars} isAdmin={isAdmin} copy={copy} />
      <SponsorsGrid sponsors={sponsors} isAdmin={isAdmin} />
      <JoinCTA isAuthenticated={!!user} copy={copy} canEditCopy={isAdmin} />
      <PublicFooter />
    </main>
  );
}
