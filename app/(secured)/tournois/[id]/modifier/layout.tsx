import type { Metadata } from "next";
import { siteTitle } from "@/lib/shared/page-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { tournamentEditFormMessages } from "@/lib/shared/tournament-actions-text";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";

type MetadataProps = {
  params: Promise<{ id: string }>;
};

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
 * bonne réponse pour un écran de travail réservé au staff. Lot 8b-2 : titre,
 * canonique et `hreflang` dans la langue de l'adresse.
 */
export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const locale = await requestLocale();
  const { id } = await params;
  const path = `/tournois/${id}/modifier`;
  const languages = localeAlternates(path);
  const canonical = localeHref(path, locale);
  return {
    // Titre écrit en entier : la mise en page du tournoi pose un `title.absolute`,
    // ce qui **retire** le gabarit de la racine pour ses enfants — un simple
    // « Modifier le tournoi » se serait retrouvé seul dans l'onglet, sans le nom
    // du site.
    title: { absolute: siteTitle(messagesFor(locale).tournamentForm.meta.editTitle) },
    alternates: languages ? { canonical, languages } : { canonical },
    openGraph: null,
    twitter: null,
  };
}

/**
 * Pose le texte du formulaire — l'anglais sous `/en` seulement. Les refus et
 * l'image sont hérités du fournisseur de la fiche (`[id]/layout.tsx`), qui
 * enveloppe déjà cette page : les reposer ici les sérialiserait deux fois.
 */
export default async function EditTournamentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const messages = locale === "en" ? tournamentEditFormMessages(messagesFor(locale)) : undefined;
  return (
    <TournamentActionsTextProvider locale={locale} messages={messages}>
      {children}
    </TournamentActionsTextProvider>
  );
}
