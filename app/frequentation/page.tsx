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
  let unavailable = false;
  try {
    stats = await getAudienceStats();
  } catch (error) {
    // Base injoignable : la page reste lisible, avec un état « indisponible » distinct de l'état vide.
    unavailable = true;
    console.error("[audience] lecture des statistiques impossible", error);
  }
  // Le tableau de bord pose lui-même `<main id="contenu">`, entre son en-tête et
  // son pied de page (repères `banner` et `contentinfo` hors de `main`). Pas de
  // `PublicPageShell` : page formelle hors du site vitrine (D76).
  return <AudienceDashboard stats={stats} unavailable={unavailable} messages={messagesFor(locale).audience} locale={locale} />;
}
