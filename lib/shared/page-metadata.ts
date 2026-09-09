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
};

export function pageMetadata({
  title,
  description,
  shareDescription,
  path,
  selfTitled = false,
}: PageMetadataInput): Metadata {
  const share = shareDescription ?? description;
  // L'encart, lui, n'hérite d'aucun gabarit : son titre porte le nom du site,
  // sans quoi « Bénévoles » collé seul dans un salon ne dit pas de qui il parle.
  const shareTitle = `${title} · ${SITE_NAME}`;

  return {
    // `absolute` court-circuite le gabarit : ici non pour l'éviter — il ne
    // s'appliquerait pas — mais pour écrire à la main ce qu'il aurait écrit.
    title: selfTitled ? { absolute: shareTitle } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "fr_FR",
      title: shareTitle,
      description: share,
      url: path,
      images: [{ url: DEFAULT_SHARE_IMAGE, width: 1200, height: 630, alt: SITE_NAME }],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: share,
      images: [DEFAULT_SHARE_IMAGE],
    },
  };
}
