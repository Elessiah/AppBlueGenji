import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/shared/share-metadata";

/**
 * Le formulaire d'édition n'est pas la fiche du tournoi.
 *
 * Il vit sous `[id]/`, donc il héritait de l'encart de partage rédigé par la
 * mise en page du tournoi : collé quelque part, `…/12/modifier` s'annonçait
 * comme le tournoi lui-même et pointait son `og:url` sur une **autre** page.
 * L'image, elle, ne suivait pas — la convention `opengraph-image` ne descend pas
 * d'un segment à l'autre —, si bien que l'encart était à la fois faux et
 * dépareillé.
 *
 * `null` retire un champ hérité : cette page n'a pas d'encart, ce qui est la
 * bonne réponse pour un écran de travail réservé au staff.
 */
export const metadata: Metadata = {
  // Titre écrit en entier : la mise en page du tournoi pose un `title.absolute`,
  // ce qui **retire** le gabarit de la racine pour ses enfants — un simple
  // « Modifier le tournoi » se serait retrouvé seul dans l'onglet, sans le nom
  // du site.
  title: { absolute: `Modifier le tournoi · ${SITE_NAME}` },
  openGraph: null,
  twitter: null,
};

export default function EditTournamentLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
