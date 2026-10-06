import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { BotLegalDoc } from "@/components/legal/BotLegalDoc";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";

/**
 * Politique de confidentialité du bot, une langue par adresse (lot 7a,
 * `docs/features/I18N.md`) : `/privacy-policy-bot` en français — l'adresse
 * déclarée au portail développeur de Discord, inchangée —, `/en/…` en anglais.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).bot.legalPages.privacy;
  return pageMetadata({
    title: meta.title,
    description: meta.description,
    path: "/privacy-policy-bot",
    shareCard: "botPrivacy",
    locale,
  });
}

export default async function PrivacyPolicyBotPage() {
  const locale = await requestLocale();
  const { legalPages } = messagesFor(locale).bot;
  return (
    <PublicPageShell>
      <BotLegalDoc doc={PRIVACY_POLICY[locale]} lang={locale} sectionLabel={legalPages.section} />
    </PublicPageShell>
  );
}
