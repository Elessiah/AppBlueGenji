import type { Metadata } from "next";
import { localeAlternates, localeHref } from "@/lib/shared/locales";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { TeamsTextProvider } from "@/components/i18n/teams-text";
import CreateTeamForm from "./CreateTeamForm";

/**
 * `/equipes/creer` et `/en/equipes/creer` (lot 9) : enveloppe serveur du
 * formulaire client — métadonnées dans la langue de l'adresse, textes de
 * l'espace `teams` (l'anglais sous `/en` seulement).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).teams;
  const path = "/equipes/creer";
  const languages = localeAlternates(path);
  const canonical = localeHref(path, locale);
  return { title: meta.createTitle, alternates: languages ? { canonical, languages } : { canonical } };
}

export default async function CreateTeamPage() {
  const locale = await requestLocale();
  const messages = locale === "en" ? messagesFor(locale).teams : undefined;
  return (
    <TeamsTextProvider locale={locale} messages={messages}>
      <CreateTeamForm />
    </TeamsTextProvider>
  );
}
