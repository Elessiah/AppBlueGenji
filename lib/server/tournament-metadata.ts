import type { Metadata } from "next";
import { getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import { SITE_DESCRIPTION, SITE_NAME, tournamentShareTitle } from "@/lib/shared/share-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { localeAlternates, localeHref, OPEN_GRAPH_LOCALE } from "@/lib/shared/locales";
import { localizedTournamentShareDescription } from "@/lib/shared/tournament-share-text";
import { parseTournamentId } from "@/lib/shared/spectator-view";

/** Droits du lecteur qui pèsent sur la visibilité d'un tournoi. */
export type TournamentMetadataRights = { canManage: boolean };

/**
 * Ce qu'un lien de tournoi raconte là où on le colle — titre, description,
 * `og:locale`, canonique et `hreflang` dans la langue de l'adresse.
 *
 * Commun à la fiche de l'espace connecté (`/tournois/[id]`) et à la page sans
 * compte (`/suivre/tournois/[id]`), qui ne diffèrent que par leur chemin et par
 * les droits du lecteur : celle-ci n'en lit aucun.
 *
 * La règle de visibilité est celle du reste du site, sans exception :
 * `getVisibleTournamentCard` l'applique par le même module pur que
 * l'instantané, et un tournoi non publié n'existe que pour la permission
 * `tournaments`. Un tournoi qu'on ne peut pas lire ne produit donc pas d'encart
 * particulier — il retombe sur celui du site, plutôt qu'un « accès refusé » qui
 * confirmerait son existence.
 *
 * La lecture est **légère** : la carte du tournoi seule, une requête indexée,
 * et non l'instantané entier (matchs, inscrites, classements, voire une
 * transaction d'entretien) dont seuls le titre et la description servent ici.
 *
 * La carte d'aperçu, dessinée par `opengraph-image.tsx` (même adresse pour les
 * deux langues), reste française.
 *
 * @param rawId Segment `[id]` tel que reçu.
 * @param pathOf Chemin (sans préfixe de langue) de la page décrite.
 * @param rights Droits du lecteur, lus seulement pour un identifiant valide ;
 *   `null` : la page ne sera pas servie à ce lecteur (redirection), l'encart du
 *   site suffit et la base n'est pas interrogée.
 */
export async function tournamentPageMetadata(
  rawId: string,
  pathOf: (tournamentId: number) => string,
  rights: () => Promise<TournamentMetadataRights | null>,
): Promise<Metadata> {
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

  const tournamentId = parseTournamentId(rawId);
  if (tournamentId === null) return fallback;

  // Une base injoignable ne doit pas faire échouer la page entière : sans ce
  // filet, une panne de lecture rendrait la fiche inaccessible au lieu de la
  // laisser afficher son propre message d'erreur.
  const card = await rights()
    .then((granted) => (granted ? getVisibleTournamentCard(tournamentId, granted) : null))
    .catch(() => null);

  if (!card) return fallback;

  const title = tournamentShareTitle(card);
  const description = localizedTournamentShareDescription(card, locale, messages);
  const path = pathOf(tournamentId);
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
