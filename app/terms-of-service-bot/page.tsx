import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { BotLegalDoc } from "@/components/legal/BotLegalDoc";
import { TERMS_OF_SERVICE } from "@/lib/shared/bot-legal-content";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";

/**
 * Conditions d'utilisation du bot, une langue par adresse (lot 7a,
 * `docs/features/I18N.md`) : `/terms-of-service-bot` en français — l'adresse
 * déclarée au portail développeur de Discord, inchangée —, `/en/…` en anglais.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).bot.legalPages.terms;
  return pageMetadata({
    title: meta.title,
    description: meta.description,
    path: "/terms-of-service-bot",
    shareCard: "botTerms",
    locale,
  });
}

export default async function TermsOfServiceBotPage() {
  const locale = await requestLocale();
  const { legalPages } = messagesFor(locale).bot;
  return (
    <PublicPageShell>
      <BotLegalDoc doc={TERMS_OF_SERVICE[locale]} lang={locale} sectionLabel={legalPages.section} />
    </PublicPageShell>
  );
}
