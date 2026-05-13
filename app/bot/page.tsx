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

export default async function BotPage() {
  return (
    <>
      <PublicHeader />

      <main>
        <div className="container">
          <BotCrumb />
          <BotHero />
          <BotStatusStrip />
          <BotKpis />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 40 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <BotActivityChart />
              <BotServersTable />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <BotLiveFeed />
              <BotLatencyCard />
            </div>
          </div>

          <BotModules />
          <div style={{ height: 24 }} />
          <BotCommands />
          <BotInviteCard />
        </div>
      </main>

      <PublicFooter />
    </>
  );
}
