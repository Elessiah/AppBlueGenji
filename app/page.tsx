import type { Metadata } from "next";
import { Ticker } from "@/components/cyber";
import { JsonLd } from "@/components/seo/JsonLd";
import { LandingTextProvider } from "@/components/i18n/landing-text";
import { landingClientMessages } from "@/lib/shared/landing-text";
import { AboutSection } from "@/components/cyber/landing/AboutSection";
import { SiteCopyEditorProvider } from "@/components/cyber/landing/EditableCopy";
import { Hero } from "@/components/cyber/landing/Hero";
import { JoinCTA } from "@/components/cyber/landing/JoinCTA";
import { LeaderCal } from "@/components/cyber/landing/LeaderCal";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { Reveal } from "@/components/cyber/landing/Reveal";
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
import { getSiteCopyBundle } from "@/lib/server/site-copy-service";
import { can } from "@/lib/shared/permissions";
import { loadMiniBracket } from "@/lib/server/tournaments/bracket-loader";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { requestLocale } from "@/lib/server/request-locale";
import { landingServerText } from "@/lib/server/i18n-landing";
import { messagesFor } from "@/lib/server/i18n-messages";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { organizationJsonLd, webSiteJsonLd } from "@/lib/shared/structured-data";

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
 *
 * Traduit au lot 2 (`docs/features/I18N.md` § Accueil) : la langue vient de la
 * requête, d'où un `generateMetadata` — canonique dans la langue, `hreflang`
 * réciproques (`x-default` = français).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { t } = landingServerText(locale);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: "/",
    // Le gabarit de la racine ne s'applique pas à la page qui partage son
    // segment : sans ce drapeau, l'accueil serait la seule page du site à ne pas
    // porter le nom du site dans son titre.
    selfTitled: true,
    locale,
  });
}

export default async function HomePage() {
  const locale = await requestLocale();
  const description = landingServerText(locale).t("meta.description");
  const buckets = await listTournamentBuckets(null).catch(() => ({
    upcoming: [],
    registration: [],
    running: [],
    finished: [],
  }));

  const featured = chooseFeaturedTournament(buckets);
  const [stats, live, leaderboard, events, ticker, sponsors, aboutStats, aboutPillars, miniBracket, user, copyBundle] =
    await Promise.all([
      getLandingStats(),
      getLandingLive(),
      getLandingLeaderboard(),
      getLandingCalendar(buckets, 5),
      getLandingTicker(locale),
      listSponsors().catch(() => []),
      listAboutStats(),
      listAboutPillars(),
      featured ? loadMiniBracket(featured.id, locale) : Promise.resolve([]),
      getCurrentUser().catch(() => null),
      getSiteCopyBundle(),
    ]);
  // Gestion du site vitrine : administrateurs + Community Managers.
  const isAdmin = can(user, "showcase");
  // Jamais de repli français sous `/en` : `copyBundle.en` sert l'anglais
  // enregistré, ou l'anglais d'origine (règle de rattrapage, `resolveSiteCopy`).
  const copy = locale === "en" ? copyBundle.en : copyBundle.fr;

  const base = siteCanonicalBase();

  return (
    <PublicPageShell>
      {/*
        L'association et le site sont deux nœuds distincts, liés par une identité
        stable : c'est ce qui permet à un moteur de rattacher la page association
        à la même structure plutôt que d'en déclarer une seconde.
      */}
      <JsonLd data={[organizationJsonLd(base, description), webSiteJsonLd(base, description, locale)]} />
      {/* Français inclus dans le paquet : seul l'anglais voyage jusqu'au navigateur,
          réduit aux espaces que lisent les composants clients. */}
      <LandingTextProvider locale={locale} messages={locale === DEFAULT_LOCALE ? undefined : landingClientMessages(messagesFor(locale).landing)}>
        {/* L'éditeur bilingue ne reçoit ses textes que pour le staff `showcase`. */}
        <SiteCopyEditorProvider entries={isAdmin ? copyBundle.editor : null}>
          <Hero stats={stats} live={live} nextUpcoming={featured} copy={copy} canEditCopy={isAdmin} />
          <Ticker items={ticker.items} />
          {/* Apparition au défilement, une fois : sans JavaScript, tout est visible. */}
          <Reveal>
            <TournamentBoard buckets={buckets} featured={featured} miniBracket={miniBracket} locale={locale} />
          </Reveal>
          <Reveal>
            <LeaderCal leaderboard={leaderboard} events={events} locale={locale} />
          </Reveal>
          <Reveal>
            <AboutSection stats={aboutStats} pillars={aboutPillars} isAdmin={isAdmin} copy={copy} locale={locale} />
          </Reveal>
          <Reveal>
            <SponsorsGrid sponsors={sponsors} copy={copy} isAdmin={isAdmin} />
          </Reveal>
          <Reveal>
            <JoinCTA isAuthenticated={!!user} copy={copy} canEditCopy={isAdmin} locale={locale} />
          </Reveal>
        </SiteCopyEditorProvider>
      </LandingTextProvider>
    </PublicPageShell>
  );
}
