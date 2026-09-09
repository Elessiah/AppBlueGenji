import type { Metadata } from "next";
import { Ticker } from "@/components/cyber";
import { JsonLd } from "@/components/seo/JsonLd";
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
import { listAboutPillars } from "@/lib/server/about-pillars-service";
import { getCurrentUser } from "@/lib/server/auth";
import { getSiteCopy } from "@/lib/server/site-copy-service";
import { can } from "@/lib/shared/permissions";
import { loadMiniBracket } from "@/lib/server/tournaments/bracket-loader";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { SITE_DESCRIPTION } from "@/lib/shared/share-metadata";
import { organizationJsonLd, webSiteJsonLd } from "@/lib/shared/structured-data";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";

export const dynamic = "force-dynamic";

/**
 * L'accueil était la seule page de la vitrine à ne déclarer **aucune**
 * métadonnée : elle retombait sur le socle de la racine, dont le titre est le
 * seul nom du site. Deux conséquences mesurables — un `<title>` sans un mot de
 * ce qu'on y trouve (« BlueGenji Esport » ne contient ni « tournoi », ni
 * « Overwatch », ni « esport »), et aucune URL canonique, alors que l'accueil est
 * justement la page que l'on atteint par le plus d'adresses différentes.
 *
 * Le titre rend « Tournois esport amateurs Overwatch · BlueGenji Esport » : la
 * marque reste dite, mais elle vient après ce qu'on cherche. Elle est écrite
 * ici plutôt que laissée au gabarit de la racine, qui ne s'applique **pas** à la
 * page partageant son segment (voir `selfTitled`).
 */
export const metadata: Metadata = pageMetadata({
  title: "Tournois esport amateurs Overwatch",
  description: SITE_DESCRIPTION,
  path: "/",
  // Le gabarit de la racine ne s'applique pas à la page qui partage son
  // segment : sans ce drapeau, l'accueil serait la seule page du site à ne pas
  // porter le nom du site dans son titre.
  selfTitled: true,
});

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

  const base = siteCanonicalBase();

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      {/*
        L'association et le site sont deux nœuds distincts, liés par une identité
        stable : c'est ce qui permet à un moteur de rattacher la page association
        à la même structure plutôt que d'en déclarer une seconde.
      */}
      <JsonLd
        data={[
          organizationJsonLd(base, SITE_DESCRIPTION),
          webSiteJsonLd(base, SITE_DESCRIPTION),
        ]}
      />
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
