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
import { getCurrentUser } from "@/lib/server/auth";
import { isStaffMember } from "@/lib/shared/permissions";

export const metadata: Metadata = pageMetadata({
  title: "BlueGenji Bot",
  description:
    "Le bot Discord de BlueGenji : annonces synchronisées entre serveurs affiliés, statistiques et commandes de tournoi.",
  shareDescription:
    "Annonces synchronisées, statistiques et commandes de tournoi, directement dans Discord.",
  path: "/bot",
});

// Pas de `export const revalidate` : la mise en page racine lit `headers()`
// (nonce de la CSP), donc cette page est rendue à chaque requête quoi qu'on y
// déclare. Le cache est celui des lectures du bot (`bot-showcase-cache`).
export default async function BotPage() {
  const [status, kpis, serversPayload, activity, user] = await Promise.all([
    cachedBotStatus(),
    cachedBotKpis(),
    cachedBotServers(8),
    cachedBotActivity(),
    getCurrentUser(),
  ]);
  const isStaff = isStaffMember(user);

  return (
    <>
      <PublicHeader />

      <main>
        <div className="container bot-container">
          <BotCrumb />
          <BotHero status={status} />
          <BotStatusStrip status={status} />
          <BotKpis kpis={kpis} />

          <div className="bot-grid">
            <div className="bot-stack">
              <BotActivityChart initial={activity} />
              {/* La charge entière, et non `serversPayload?.servers ?? null` :
                  ce `??` ramenait « le bot a répondu sans champ `servers` » à
                  « le bot n'a pas répondu », et le panneau annonçait
                  « BOT INJOIGNABLE » pendant que la bande d'état, tirée du
                  même `Promise.all`, affichait `OPERATIONAL` juste au-dessus. */}
              <BotServersTable payload={serversPayload} />
            </div>
            <div className="bot-stack">
              <BotLiveFeed />
              <BotLatencyCard status={status} />
            </div>
          </div>

          <BotCommands isStaff={isStaff} />
          <BotInviteCard />
        </div>
      </main>

      <PublicFooter />
    </>
  );
}
