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
import { fetchBotStats, fetchBotStatus, fetchBotKpis, fetchBotServers, fetchBotActivity } from '@/lib/server/bot-integration';

export const metadata: Metadata = pageMetadata({
  title: "BlueGenji Bot",
  description:
    "Le bot Discord de BlueGenji : annonces synchronisées entre serveurs affiliés, statistiques et commandes de tournoi.",
  shareDescription:
    "Annonces synchronisées, statistiques et commandes de tournoi, directement dans Discord.",
  path: "/bot",
});

export const revalidate = 30;

export default async function BotPage() {
  const [, status, kpis, serversPayload, activity30j] = await Promise.all([
    fetchBotStats(),
    fetchBotStatus(),
    fetchBotKpis(),
    fetchBotServers(8),
    fetchBotActivity('30j'),
  ]);

  return (
    <>
      <PublicHeader />

      <main>
        <div className="container">
          <BotCrumb />
          <BotHero />
          <BotStatusStrip status={status} />
          <BotKpis kpis={kpis} />

          <div className="bot-grid">
            <div className="bot-stack">
              <BotActivityChart initial={activity30j} />
              <BotServersTable servers={serversPayload?.servers ?? null} />
            </div>
            <div className="bot-stack">
              <BotLiveFeed />
              <BotLatencyCard status={status} />
            </div>
          </div>

          <BotCommands />
          <BotInviteCard />
        </div>
      </main>

      <PublicFooter />
    </>
  );
}
