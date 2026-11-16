import type { Metadata } from "next";
import { getVisibleTournamentCard } from "@/lib/server/tournaments-service";
import { requestCache } from "@/lib/server/request-cache";
import type { TournamentCard } from "@/lib/shared/types";
import { SHARE_CARD_SIZE, SITE_DESCRIPTION, SITE_NAME, tournamentShareTitle } from "@/lib/shared/share-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { localeAlternates, localeHref, OPEN_GRAPH_LOCALE } from "@/lib/shared/locales";
import { localizedTournamentShareDescription } from "@/lib/shared/tournament-share-text";
import { parseTournamentId } from "@/lib/shared/spectator-view";
import { cachedTournamentShare, type PublicTournamentShare } from "@/lib/server/spectator-snapshot";
import { tournamentEmbedAlt } from "@/lib/shared/share-embed-cards";
import {
  embedShareImagePath,
  tournamentShareCardKey,
  tournamentShareVersion,
  tournamentShareVersionWithoutSummary,
} from "@/lib/shared/share-embeds";
import type { Locale } from "@/lib/shared/locales";
import { pageShareImagePath } from "@/lib/shared/page-share-cards";

/** Droits du lecteur qui pèsent sur la visibilité d'un tournoi. */
export type TournamentMetadataRights = { canManage: boolean };

/** Lecture de la carte d'un tournoi visible pour ces droits (`null` : illisible). */
export type TournamentMetadataCardLoader = (
  tournamentId: number,
  rights: TournamentMetadataRights,
) => Promise<TournamentCard | null>;

/**
 * La carte visible du tournoi, lue **une fois par requête** et par droits : la
 * mise en page du tournoi, celle d'une page de match et son contrôle 404 la
 * lisaient chacune (`docs/features/MATCH_PAGE.md`).
 */
const visibleCardForRequest = requestCache((tournamentId: number, canManage: boolean) =>
  getVisibleTournamentCard(tournamentId, { canManage }),
);

/** Lecteur par défaut de la carte : `getVisibleTournamentCard`, mémoïsé pour la requête. */
export const loadVisibleTournamentCard: TournamentMetadataCardLoader = (tournamentId, rights) =>
  visibleCardForRequest(tournamentId, rights.canManage);

/**
 * Lecture du résumé d'aperçu public d'un tournoi (`SHARE_EMBEDS.md`) : engagé
 * en tête, matchs. `null` : rien en mémoire, ou tournoi non public.
 */
export type TournamentShareLoader = (tournamentId: number) => Promise<PublicTournamentShare | null>;

/** Lecteur par défaut : la copie publique **déjà en mémoire**, sans lecture ni jeton. */
export const cachedTournamentShareLoader: TournamentShareLoader = async (tournamentId) =>
  cachedTournamentShare(tournamentId);

/** L'image d'aperçu publiée par un encart : adresse versionnée, taille, texte alternatif. */
export function embedImageMetadata(key: string, locale: Locale, version: string, alt: string) {
  return { url: embedShareImagePath(key, locale, version), ...SHARE_CARD_SIZE, alt };
}

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
 * L'image d'aperçu est celle du tournoi (`/og/<langue>/tournament-<id>.png`,
 * `SHARE_EMBEDS.md`), dans la langue de l'adresse et versionnée par ce qu'elle
 * dessine : l'équipe en tête vient du résumé public (`loadShare`), jamais de
 * l'instantané des membres. La route de l'image applique seule la règle de
 * visibilité publique : un tournoi non publié y rend la carte neutre.
 *
 * @param rawId Segment `[id]` tel que reçu.
 * @param pathOf Chemin (sans préfixe de langue) de la page décrite.
 * @param rights Droits du lecteur, lus seulement pour un identifiant valide ;
 *   `null` : la page ne sera pas servie à ce lecteur (redirection), l'encart du
 *   site suffit et la base n'est pas interrogée.
 * @param loadCard Lecture de la carte : par défaut `getVisibleTournamentCard`,
 *   mémoïsée pour la requête (`loadVisibleTournamentCard`).
 *   La page sans compte lit celle de la réponse publique mutualisée
 *   (`publicTournamentSnapshot`) : une rafale de F5 ou une annonce Discord ne
 *   coûte plus une requête par vue.
 * @param loadShare Résumé d'aperçu public : par défaut la copie déjà en
 *   mémoire (`cachedTournamentShareLoader`), jamais une reconstruction payée
 *   par un robot d'aperçu ; la page d'un match lit la réponse publique
 *   (`publicTournamentShareForRequest`).
 */
export async function tournamentPageMetadata(
  rawId: string,
  pathOf: (tournamentId: number) => string,
  rights: () => Promise<TournamentMetadataRights | null>,
  loadCard: TournamentMetadataCardLoader = loadVisibleTournamentCard,
  loadShare: TournamentShareLoader = cachedTournamentShareLoader,
): Promise<Metadata> {
  const locale = await requestLocale();
  const messages = messagesFor(locale);
  // L'encart du site, posé en entier : sans lui, la fiche hériterait de la
  // carte générique de `/tournois` (mise en page parente), dont le texte ne
  // correspond pas à l'image du site. Celle-ci est posée ici : un `openGraph`
  // de page remplace celui du parent, image comprise.
  const siteImage = { url: pageShareImagePath("home", locale), ...SHARE_CARD_SIZE, alt: SITE_NAME };
  const fallback: Metadata = {
    title: messages.tournamentServer.meta.fallbackTitle,
    description: SITE_DESCRIPTION,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OPEN_GRAPH_LOCALE[locale],
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      images: [siteImage],
    },
    twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION, images: [siteImage] },
  };

  const tournamentId = parseTournamentId(rawId);
  if (tournamentId === null) return fallback;

  // Une base injoignable ne doit pas faire échouer la page entière : sans ce
  // filet, une panne de lecture rendrait la fiche inaccessible au lieu de la
  // laisser afficher son propre message d'erreur.
  const card = await rights()
    .then((granted) => (granted ? loadCard(tournamentId, granted) : null))
    .catch(() => null);

  if (!card) return fallback;

  const title = tournamentShareTitle(card);
  const description = localizedTournamentShareDescription(card, locale, messages);
  const path = pathOf(tournamentId);
  const canonical = localeHref(path, locale);
  const languages = localeAlternates(path);
  const share = await loadShare(tournamentId).catch(() => null);
  // Le texte (titre, description, texte alternatif) vient de la carte lue
  // (`card`). L'équipe en tête vient de la copie publique en mémoire, mais
  // seulement quand celle-ci dit la **même** carte : une copie restée d'avant un
  // renommage ou une inscription n'apparie pas son équipe en tête à un nom
  // qu'elle ne dessine plus. Sans copie conforme, l'équipe en tête est inconnue
  // et l'empreinte change par fenêtre (`tournamentShareVersionWithoutSummary`).
  const copyMatchesCard =
    share !== null && tournamentShareVersion(share.card, null) === tournamentShareVersion(card, null);
  const image = embedImageMetadata(
    tournamentShareCardKey(tournamentId),
    locale,
    copyMatchesCard ? tournamentShareVersion(card, share.share.leader) : tournamentShareVersionWithoutSummary(card),
    tournamentEmbedAlt(card, messages),
  );

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
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
