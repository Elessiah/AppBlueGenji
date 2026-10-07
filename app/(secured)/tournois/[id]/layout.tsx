import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server/auth";
import { getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
import { SITE_DESCRIPTION, SITE_NAME, tournamentShareTitle } from "@/lib/shared/share-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { localeAlternates, localeHref, OPEN_GRAPH_LOCALE } from "@/lib/shared/locales";
import { localizedTournamentShareDescription } from "@/lib/shared/tournament-share-text";
import { tournamentPageMessages } from "@/lib/shared/tournament-page-text";
import { TournamentPageTextProvider } from "@/components/i18n/tournament-page-text";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";

type MetadataProps = {
  params: Promise<{ id: string }>;
};

/**
 * Ce qu'un lien de tournoi raconte là où on le colle.
 *
 * La fiche est une page cliente : elle ne peut pas exporter `generateMetadata`,
 * d'où cette mise en page, qui n'existe que pour ça et se contente de rendre son
 * enfant. Elle est atteinte **même par un visiteur non connecté** — la garde de
 * l'espace sécurisé ne redirige plus, elle rend une carte (voir
 * `app/(secured)/_shared/AuthGate.tsx`) —, ce qui est la condition pour qu'un
 * robot d'aperçu voie autre chose que la page de connexion.
 *
 * La règle de visibilité est celle du reste du site, sans exception :
 * {@link getVisibleTournamentCard} l'applique par le même module pur que
 * l'instantané, et un tournoi non publié n'existe que pour la permission
 * `tournaments`. Un tournoi qu'on ne peut
 * pas lire ne produit donc pas d'encart particulier — il retombe sur celui du
 * site, plutôt qu'un « accès refusé » qui confirmerait son existence.
 *
 * La lecture est **légère** : la carte du tournoi seule, une requête indexée,
 * et non l'instantané entier (matchs, inscrites, classements, voire une
 * transaction d'entretien) dont seuls le titre et la description servaient ici
 * — l'ouverture d'une fiche le construisait une fois pour ses métadonnées, puis
 * souvent une seconde fois pour le flux SSE, le cache ne durant que 3 s.
 */
export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  // Lot 8a-2 : titre, description, `og:locale`, canonique et `hreflang` dans
  // la langue de l'adresse (`/en/tournois/12`). La carte d'aperçu, dessinée
  // par `opengraph-image.tsx` (même adresse pour les deux langues), reste
  // française.
  const locale = await requestLocale();
  const messages = messagesFor(locale);
  // L'encart du site, posé en entier : sans lui, la fiche hériterait de la
  // carte générique de `/tournois` (mise en page parente), dont le texte ne
  // correspond pas à l'image du site que `opengraph-image.tsx` dessine ici.
  const fallback: Metadata = {
    title: messages.tournament.meta.fallbackTitle,
    description: SITE_DESCRIPTION,
    openGraph: { type: "website", siteName: SITE_NAME, locale: OPEN_GRAPH_LOCALE[locale], title: SITE_NAME, description: SITE_DESCRIPTION },
    twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION },
  };

  const { id } = await params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) return fallback;

  // Une base injoignable ne doit pas faire échouer la page entière : sans ce
  // filet, une panne de lecture rendrait la fiche inaccessible au lieu de la
  // laisser afficher son propre message d'erreur.
  const card = await getCurrentUser()
    .then((user) =>
      getVisibleTournamentCard(tournamentId, {
        canManage: user ? can(user, "tournaments") : false,
      }),
    )
    .catch(() => null);

  if (!card) return fallback;

  const title = tournamentShareTitle(card);
  const description = localizedTournamentShareDescription(card, locale, messages);
  const path = `/tournois/${tournamentId}`;
  const canonical = localeHref(path, locale);
  const languages = localeAlternates(path);

  return {
    // Le gabarit de la racine ajouterait « · BlueGenji Esport » derrière un
    // titre qui porte déjà le nom du tournoi et son jeu : `absolute` le coupe,
    // le nom du site étant de toute façon annoncé par `og:site_name`.
    title: { absolute: title },
    description,
    alternates: languages ? { canonical, languages } : { canonical },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OPEN_GRAPH_LOCALE[locale],
      title,
      description,
      url: canonical,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * Pose les textes de la fiche : rien en français (déjà dans le paquet),
 * l'espace `tournament` (sans ses parties serveur) sous `/en` seulement.
 */
export default async function TournamentDetailLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const catalog = locale === "en" ? messagesFor(locale) : null;
  const messages = catalog ? tournamentPageMessages(catalog) : undefined;
  // Gestes (lot 8b) : refus, boutons, fenêtres d'action — anglais sous `/en` seulement.
  const actions = catalog ? tournamentActionsMessages(catalog) : undefined;
  return (
    <TournamentPageTextProvider locale={locale} messages={messages}>
      <TournamentActionsTextProvider locale={locale} messages={actions}>
        {children}
      </TournamentActionsTextProvider>
    </TournamentPageTextProvider>
  );
}
