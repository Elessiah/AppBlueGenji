import type { Metadata } from "next";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { TeamsTextProvider } from "@/components/i18n/teams-text";
import TeamsList from "./TeamsList";

/**
 * `/equipes` et `/en/equipes` (lot 9) : la page reste cliente (`TeamsList`) ;
 * cette enveloppe serveur déclare ses métadonnées dans la langue de l'adresse —
 * titre, canonique et `hreflang` réciproques — et pose les textes de
 * l'annuaire (l'anglais sous `/en` seulement). `noindex` vient de la mise en
 * page de l'espace sécurisé, et la page reste hors sitemap.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).teams;
  const path = "/equipes";
  const languages = localeAlternates(path);
  const canonical = localeHref(path, locale);
  return {
    title: meta.title,
    description: meta.description,
    alternates: languages ? { canonical, languages } : { canonical },
  };
}

export default async function TeamsPage() {
  const locale = await requestLocale();
  const messages = locale === "en" ? messagesFor(locale).teams : undefined;
  return (
    <TeamsTextProvider locale={locale} messages={messages}>
      <TeamsList />
    </TeamsTextProvider>
  );
}
