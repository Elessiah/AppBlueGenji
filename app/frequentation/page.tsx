import type { Metadata } from "next";
import { getAudienceStats } from "@/lib/server/audience-service";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { AUDIENCE_PAGE_PATH, type AudienceStats } from "@/lib/shared/audience";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { AudienceDashboard } from "./AudienceDashboard";

export const dynamic = "force-dynamic";

/**
 * Statistiques de fréquentation (`docs/features/STATS_PAGE.md`, D76) : page
 * publique **non référencée** — `noindex, nofollow`, absente des menus et du
 * plan du site —, lisible par qui en a le lien (partenaires, annonceurs).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).audience;
  return {
    ...pageMetadata({ title: meta.title, description: meta.description, path: AUDIENCE_PAGE_PATH, locale }),
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  };
}

export default async function FrequentationPage() {
  const locale = await requestLocale();
  let stats: AudienceStats | null = null;
  try {
    stats = await getAudienceStats();
  } catch (error) {
    // Base injoignable : la page reste lisible, sur son état vide.
    console.error("[audience] lecture des statistiques impossible", error);
  }
  return (
    <main id="contenu">
      <AudienceDashboard stats={stats} messages={messagesFor(locale).audience} locale={locale} />
    </main>
  );
}
