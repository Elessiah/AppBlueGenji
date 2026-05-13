import './bot.css';
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
import { BotModules } from "@/components/bot/BotModules";
import { BotCommands } from "@/components/bot/BotCommands";
import { BotInviteCard } from "@/components/bot/BotInviteCard";
import { fetchBotStats, fetchBotStatus, fetchBotKpis, fetchBotServers, fetchBotActivity, fetchBotModules } from '@/lib/server/bot-integration';

export const revalidate = 30;

export default async function BotPage() {
  const [, status, kpis, serversPayload, activity30j] = await Promise.all([
    fetchBotStats(),
    fetchBotStatus(),
    fetchBotKpis(),
    fetchBotServers(8),
    fetchBotActivity('30j'),
  ]);

  const firstGuildId = serversPayload?.servers?.[0]?.id ?? null;
  const modules = firstGuildId ? await fetchBotModules(firstGuildId) : null;

  return (
    <>
      <PublicHeader />

      <main>
        <div className="container">
          <BotCrumb />
          <BotHero />
          <BotStatusStrip status={status} />
          <BotKpis kpis={kpis} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 40 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <BotActivityChart initial={activity30j} />
              <BotServersTable servers={serversPayload?.servers ?? null} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <BotLiveFeed />
              <BotLatencyCard status={status} />
            </div>
          </div>

          <BotModules payload={modules} />
          <div style={{ height: 24 }} />
          <BotCommands />
          <BotInviteCard />
        </div>
      </main>

      <PublicFooter />
    </>
  );
}
