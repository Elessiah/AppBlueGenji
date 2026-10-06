/**
 * Le socle de métadonnées d'une page de la vitrine.
 *
 * Chacune écrivait le sien : cinq pages déclaraient un `openGraph` à quatre
 * champs, quatre autres n'en déclaraient aucun, et aucune ne portait de carte
 * Twitter ni d'URL canonique. Or `openGraph` n'est **pas fusionné** avec celui
 * de la racine — un enfant qui en déclare un remplace le bloc entier : les
 * pages qui croyaient compléter le socle le remplaçaient en fait par une
 * version amputée du nom du site.
 *
 * Un seul appel écrit donc les cinq choses qui vont ensemble : le titre, la
 * description, l'image d'aperçu, l'encart de partage et l'URL canonique.
 */
import type { Metadata } from "next";
import { SITE_NAME } from "./share-metadata";
import frShare from "@/messages/fr/share.json";
import { DEFAULT_LOCALE, OPEN_GRAPH_LOCALE, localeAlternates, localeHref, type Locale } from "./locales";
import { pageShareImagePath, type PageShareCardKey } from "./page-share-cards";

/** Le gabarit de titre du site, celui que déclare la mise en page racine. */
export const SITE_TITLE_TEMPLATE = `%s · ${SITE_NAME}`;

/**
 * Un titre écrit **avec** le nom du site, là où le gabarit ne s'applique pas :
 * un encart de partage, ou un `title.absolute`.
 */
export function siteTitle(title: string): string {
  return SITE_TITLE_TEMPLATE.replace("%s", title);
}

/**
 * L'image d'aperçu par défaut du site, rendue par `app/opengraph-image.tsx`.
 *
 * Cette convention de fichier ne vaut que pour **son propre segment** : posée à
 * la racine d'`app/`, elle habille `/` et rien d'autre — vérifié, et contraire
 * à ce qu'on attendrait d'une convention par ailleurs héritée (`icon`). Les
 * autres pages la désignent donc explicitement, par la route qu'elle expose.
 */
export const DEFAULT_SHARE_IMAGE = "/opengraph-image";

export type PageMetadataInput = {
  /** Titre de la page, **sans** le nom du site : le gabarit de la racine l'ajoute. */
  title: string;
  /** Phrase de résumé, servie au moteur de recherche comme à l'encart. */
  description: string;
  /**
   * Résumé propre à l'encart de partage, quand la phrase de référencement est
   * trop technique pour un salon Discord. Par défaut, {@link description}.
   */
  shareDescription?: string;
  /** Chemin absolu de la page (« /association »), pour l'URL canonique. */
  path: string;
  /**
   * Écrire le nom du site dans le `<title>` plutôt que de le laisser au gabarit
   * de la racine.
   *
   * Le gabarit `%s · BlueGenji Esport` ne s'applique qu'aux **segments
   * enfants** : la page racine partage le segment de la mise en page qui le
   * déclare, elle ne le reçoit donc pas. L'accueil s'annonçait ainsi
   * « Tournois esport amateurs Overwatch » tout court, sans un mot de la marque
   * — le seul endroit du site où le nom manquait était celui où il compte le
   * plus. Aucune autre page n'a besoin de ce drapeau : elles sont toutes des
   * enfants.
   */
  selfTitled?: boolean;
  /**
   * Langue de la page rendue (`requestLocale()` dans un `generateMetadata`),
   * `fr` par défaut. L'URL canonique est celle de **cette** langue.
   */
  locale?: Locale;
  /**
   * Carte d'aperçu propre à la page (`lib/shared/page-share-cards.ts`), servie
   * dans la langue de la page (`/og/<langue>/<clé>.png`). Absente : la carte
   * du site ({@link DEFAULT_SHARE_IMAGE}).
   */
  shareCard?: string;
  /**
   * Texte de remplacement de la carte quand elle ne montre pas le titre de
   * l'encart (le podium de `/classement`). Par défaut, ce titre.
   */
  shareImageAlt?: string;
};

/** L'image d'aperçu d'une page : sa carte dans sa langue, ou celle du site. */
export function shareImageFor(shareCard: string | undefined, locale: Locale = DEFAULT_LOCALE): string {
  return shareCard ? pageShareImagePath(shareCard, locale) : DEFAULT_SHARE_IMAGE;
}

export function pageMetadata({
  title,
  description,
  shareDescription,
  path,
  selfTitled = false,
  locale = DEFAULT_LOCALE,
  shareCard,
  shareImageAlt,
}: PageMetadataInput): Metadata {
  const share = shareDescription ?? description;
  const image = shareImageFor(shareCard, locale);
  // L'encart, lui, n'hérite d'aucun gabarit : son titre porte le nom du site,
  // sans quoi « Bénévoles » collé seul dans un salon ne dit pas de qui il parle.
  const shareTitle = siteTitle(title);
  // Chaque langue est sa propre canonique — jamais l'anglais vers le
  // français, que Google lirait comme un doublon à écarter. Les `hreflang`
  // réciproques (`x-default` = français) n'existent que pour une route
  // traduite (`lib/shared/i18n-routes.ts`) : annoncer une page anglaise qui
  // redirige serait faux.
  const canonical = localeHref(path, locale);
  const languages = localeAlternates(path);

  return {
    // `absolute` court-circuite le gabarit : ici non pour l'éviter — il ne
    // s'appliquerait pas — mais pour écrire à la main ce qu'il aurait écrit.
    title: selfTitled ? { absolute: shareTitle } : title,
    description,
    alternates: languages ? { canonical, languages } : { canonical },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OPEN_GRAPH_LOCALE[locale],
      title: shareTitle,
      description: share,
      url: canonical,
      // Le texte de l'image est le titre de l'encart : c'est ce qu'elle montre,
      // sauf carte au contenu propre (podium), qui fournit le sien.
      images: [{ url: image, width: 1200, height: 630, alt: shareCard ? (shareImageAlt ?? shareTitle) : SITE_NAME }],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: share,
      images: [image],
    },
  };
}

/**
 * L'encart d'une page **réservée aux membres** (`/tournois`, `/equipes`,
 * `/equipes/[id]`, `/joueurs`, `/joueurs/[id]`), posé par la mise en page de
 * son segment.
 *
 * Générique par construction : titre et phrase sont ceux de la carte, jamais
 * le nom d'une équipe ou le pseudo d'un joueur — le robot d'aperçu n'a pas de
 * session, et le `<head>` anonyme de ces pages n'en montre pas non plus. Pas
 * d'`og:url` : la mise en page habille aussi ses sous-pages (`/equipes/creer`),
 * qu'une adresse fixe désignerait mal. Pages non traduites : français seul.
 */
export function memberAreaShareMetadata(key: PageShareCardKey): Pick<Metadata, "openGraph" | "twitter"> {
  const { title, subtitle } = frShare.pages[key];
  const shareTitle = siteTitle(title);
  const image = pageShareImagePath(key, DEFAULT_LOCALE);
  return {
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OPEN_GRAPH_LOCALE[DEFAULT_LOCALE],
      title: shareTitle,
      description: subtitle,
      images: [{ url: image, width: 1200, height: 630, alt: shareTitle }],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description: subtitle, images: [image] },
  };
}

/**
 * Le titre d'une **mise en page** de segment, qui nomme sa page et laisse le
 * gabarit du site aux pages qu'elle contient.
 *
 * Un titre en chaîne ne suffit pas, et la panne ne se voit que sur les
 * sous-pages : Next transmet aux segments enfants le gabarit du titre **résolu**
 * de la mise en page, qu'une chaîne remet à `null`. Posé en `"Tournois"`,
 * `/tournois` s'intitulait bien « Tournois · BlueGenji Esport », mais
 * `/tournois/creer` devenait « Créer un tournoi » tout court. `default` nomme la
 * page du segment (en passant par le gabarit de la racine), `template` le
 * repose pour les suivantes.
 */
export function segmentTitle(title: string): { default: string; template: string } {
  return { default: title, template: SITE_TITLE_TEMPLATE };
}
