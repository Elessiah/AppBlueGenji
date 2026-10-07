import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { tournamentFormMessages } from "@/lib/shared/tournament-actions-text";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";

const PATH = "/tournois/creer";

/**
 * Le formulaire de création n'est pas la liste : sans ce titre, il héritait
 * de « Tournois ». Lot 8b-2 : titre, canonique et `hreflang` dans la langue de
 * l'adresse (`/en/tournois/creer`) — page de l'espace sécurisé, toujours
 * `noindex` et hors sitemap.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const languages = localeAlternates(PATH);
  const canonical = localeHref(PATH, locale);
  return {
    title: segmentTitle(messagesFor(locale).tournamentForm.meta.createTitle),
    alternates: languages ? { canonical, languages } : { canonical },
  };
}

/**
 * Pose les textes du formulaire (refus, image, formulaire) : rien en français
 * (déjà dans le paquet), l'anglais sous `/en` seulement.
 */
export default async function CreateTournamentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const messages = locale === "en" ? tournamentFormMessages(messagesFor(locale)) : undefined;
  return (
    <TournamentActionsTextProvider locale={locale} messages={messages}>
      {children}
    </TournamentActionsTextProvider>
  );
}
