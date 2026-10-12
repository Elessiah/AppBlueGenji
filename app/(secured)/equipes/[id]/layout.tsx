import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server/auth";
import { getTeamPageIdentity } from "@/lib/server/teams/detail";
import { parseEntityPageId, teamPageTitle } from "@/lib/shared/entity-page-titles";
import { memberAreaShareMetadata } from "@/lib/shared/page-metadata";
import { teamShareCardKey } from "@/lib/shared/page-share-cards";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { TeamPageTextProvider } from "@/components/i18n/team-page-text";
import { StatsPanelI18nProvider } from "@/components/i18n/stats-panel-i18n";
import { statsPanelMessages } from "@/lib/shared/stats-text";

type MetadataProps = {
  params: Promise<{ id: string }>;
};

/**
 * Le titre de la fiche d'une équipe (WCAG 2.4.2) : son nom, et non « Équipes »,
 * hérité de l'annuaire — deux onglets sur deux équipes portaient le même.
 *
 * La fiche est une page cliente, d'où cette mise en page, qui n'existe que pour
 * ça. Un titre, l'encart de la fiche (texte générique, image nominative tirée
 * du classement public — `docs/features/SHARE_METADATA.md` § « La carte d'une
 * équipe »), et depuis le lot 9 la canonique et les `hreflang` de **cette**
 * fiche (une mise en page de fiche n'a pas de sous-page à qui les transmettre) ;
 * pas d'`og:url` (voir `app/(secured)/tournois/layout.tsx`).
 *
 * Le nom n'est lu que pour un lecteur connecté : la fiche est refusée aux
 * autres (`GET /api/teams/[id]` répond 401, la garde rend la carte « Connexion
 * requise »), et l'onglet ne doit pas dire ce que la page tait. Une base
 * injoignable retombe sur le titre générique plutôt que de faire échouer la
 * page, qui affiche alors sa propre erreur.
 */
export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { id } = await params;
  const locale = await requestLocale();
  const words = { fallback: messagesFor(locale).team.meta.fallbackTitle };
  const teamId = parseEntityPageId(id);
  if (teamId === null) return { title: teamPageTitle(null, words), ...memberAreaShareMetadata("team", "team", locale) };

  const team = await getCurrentUser()
    .then((user) => (user ? getTeamPageIdentity(teamId) : null))
    .catch(() => null);

  // L'image nominative (`/og/<langue>/team-<id>.png`) se lit dans sa route,
  // pas ici : aucune requête de plus pour la fiche, et rien qui dépende du
  // lecteur. Canonique et `hreflang` dans la langue de l'adresse (lot 9).
  const path = `/equipes/${teamId}`;
  const languages = localeAlternates(path);
  const canonical = localeHref(path, locale);
  return {
    title: teamPageTitle(team, words),
    alternates: languages ? { canonical, languages } : { canonical },
    ...memberAreaShareMetadata("team", teamShareCardKey(teamId), locale),
  };
}

/**
 * Pose les textes de la fiche et ceux du bloc de statistiques : l'anglais sous
 * `/en` seulement (lot 9).
 */
export default async function TeamDetailLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const messages = locale === "en" ? messagesFor(locale) : undefined;
  return (
    <TeamPageTextProvider locale={locale} messages={messages?.team}>
      <StatsPanelI18nProvider value={messages ? { locale, messages: statsPanelMessages(messages) } : undefined}>
        {children}
      </StatsPanelI18nProvider>
    </TeamPageTextProvider>
  );
}
