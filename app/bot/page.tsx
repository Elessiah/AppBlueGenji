import './bot.css';
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { BotCrumb } from "@/components/bot/BotCrumb";
import { BotHero } from "@/components/bot/BotHero";
import { BotStatusStrip } from "@/components/bot/BotStatusStrip";
import { BotKpis } from "@/components/bot/BotKpis";
import { BotActivityChart } from "@/components/bot/BotActivityChart";
import { BotServersTable } from "@/components/bot/BotServersTable";
import { BotLiveFeed } from "@/components/bot/BotLiveFeed";
import { BotLatencyCard } from "@/components/bot/BotLatencyCard";
import { BotCommands } from "@/components/bot/BotCommands";
import { BotInviteCard } from "@/components/bot/BotInviteCard";
import {
  cachedBotActivity,
  cachedBotKpis,
  cachedBotServers,
  cachedBotStatus,
} from "@/lib/server/bot-showcase-cache";
import { BotTextProvider } from "@/components/i18n/bot-text";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { botClientMessages, botText } from "@/lib/shared/bot-text";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";
import { isStaffMember } from "@/lib/shared/permissions";

/**
 * Page traduite (`/en/bot`, lot 5a — `docs/features/I18N.md` § Bot) :
 * métadonnées, canonique et `hreflang` dans la langue, carte d'aperçu anglaise
 * (`/og/en/bot.png`).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).bot;
  return pageMetadata({
    title: meta.title,
    description: meta.description,
    shareDescription: meta.shareDescription,
    path: "/bot",
    shareCard: "bot",
    locale,
  });
}

// Pas de `export const revalidate` : la mise en page racine lit `headers()`
// (nonce de la CSP), donc cette page est rendue à chaque requête quoi qu'on y
// déclare. Le cache est celui des lectures du bot (`bot-showcase-cache`).
export default async function BotPage() {
  const locale = await requestLocale();
  const messages = messagesFor(locale).bot;
  const text = botText(locale, messages);
  const [status, kpis, serversPayload, activity, user] = await Promise.all([
    cachedBotStatus(),
    cachedBotKpis(),
    cachedBotServers(8),
    cachedBotActivity(),
    getCurrentUser(),
  ]);
  const isStaff = isStaffMember(user);

  return (
    // Les composants client (bande d'état, flux) lisent leurs textes par ce
    // fournisseur ; l'anglais ne voyage que sous `/en`.
    <BotTextProvider locale={locale} messages={locale === DEFAULT_LOCALE ? undefined : botClientMessages(messages)}>
      <PublicHeader />

      <main>
        <div className="container bot-container">
          <BotCrumb text={text} />
          <BotHero status={status} text={text} />
          <BotStatusStrip status={status} />
          <BotKpis kpis={kpis} text={text} />

          <div className="bot-grid">
            <div className="bot-stack">
              <BotActivityChart initial={activity} text={text} />
              {/* La charge entière, et non `serversPayload?.servers ?? null` :
                  ce `??` ramenait « le bot a répondu sans champ `servers` » à
                  « le bot n'a pas répondu », et le panneau annonçait
                  « BOT INJOIGNABLE » pendant que la bande d'état, tirée du
                  même `Promise.all`, affichait `OPERATIONAL` juste au-dessus. */}
              <BotServersTable payload={serversPayload} text={text} />
            </div>
            <div className="bot-stack">
              <BotLiveFeed />
              <BotLatencyCard status={status} text={text} />
            </div>
          </div>

          <BotCommands isStaff={isStaff} text={text} />
          <BotInviteCard text={text} />
        </div>
      </main>

      <PublicFooter />
    </BotTextProvider>
  );
}
