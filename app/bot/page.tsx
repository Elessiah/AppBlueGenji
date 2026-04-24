import Link from "next/link";
import { PageWithPalette } from "@/components/page-with-palette";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { CyberButton } from "@/components/cyber/CyberButton";
import { CyberCard } from "@/components/cyber/CyberCard";
import { fetchBotStats } from "@/lib/server/bot-integration";

const FEATURES = [
  {
    tag: "ANNONCES",
    title: "Inter-serveurs",
    desc: "Synchronisation des channels Discord partenaires pour diffuser vos scrims, recrutement et événements.",
  },
  {
    tag: "SCRIMS",
    title: "Matchmaking",
    desc: "Système de proposition d'équipes et matchmaking pour organiser vos scrimmages.",
  },
  {
    tag: "RECRUTEMENT",
    title: "Staff & joueurs",
    desc: "Poste ta recherche d'équipe, coachdown ou staff sur plusieurs serveurs à la fois.",
  },
  {
    tag: "NOTIFICATIONS",
    title: "Tournois en direct",
    desc: "Reçois un ping au démarrage de ton bracket, suivi des résultats en temps réel.",
  },
  {
    tag: "AUTHENTIFICATION",
    title: "Discord OAuth",
    desc: "Connexion unifiée en deux clics via Discord, sans mot de passe.",
  },
  {
    tag: "STATISTIQUES",
    title: "Analytics",
    desc: "Tableau de bord des matchs, wins/losses et ranking sur 30 jours.",
  },
];

const COMMANDS = [
  { cmd: "/ping", desc: "Test la connexion au bot." },
  { cmd: "/scrim", desc: "Propose une équipe pour un scrim." },
  { cmd: "/recrute", desc: "Lance une annonce de recrutement." },
  { cmd: "/link", desc: "Lie ton compte Discord à ton profil BlueGenji." },
  { cmd: "/stats", desc: "Affiche tes stats personnelles." },
  { cmd: "/help", desc: "Liste toutes les commandes disponibles." },
];

export default async function BotPage() {
  const stats = await fetchBotStats();
  const statsFallback = (value: number) => (value >= 0 ? value : "—");

  return (
    <PageWithPalette palette="blue">
      <PublicHeader />

      <main style={{ position: "relative" }}>
        <section className="container" style={{ padding: "80px 0" }}>
          <div className="fabric" />
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 64, alignItems: "start" }}>
            <div>
              <span className="eyebrow">BOT DISCORD · INTER-SERVEURS</span>
              <h1 className="display" style={{ fontSize: 72, marginBottom: 20 }}>
                Le réseau.<br />
                <span style={{ color: "var(--blue-500)" }}>Connecté.</span>
              </h1>
              <p style={{ fontSize: 17, color: "var(--ink-mute)", maxWidth: 520, margin: "20px 0 32px", lineHeight: 1.65 }}>
                Un bot Discord qui relaie les annonces entre serveurs affiliés. Scrims, recrutement staff, cast,
                coaching — la communauté Overwatch 2 francophone, unifiée.
              </p>
              <div style={{ display: "flex", gap: 12 }}>
                <CyberButton variant="primary" asChild>
                  <a
                    href="https://discord.com/api/oauth2/authorize?client_id=1234567890&permissions=1099511627776&scope=bot%20applications.commands"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Inviter le bot →
                  </a>
                </CyberButton>
                <CyberButton variant="ghost" asChild>
                  <a href="https://docs.bluegenji-esport.fr/bot" target="_blank" rel="noreferrer">
                    Documentation
                  </a>
                </CyberButton>
              </div>
            </div>

            <CyberCard ticks style={{ padding: 32 }}>
              <div className="eyebrow">ACTIVITÉ 30 DERNIERS JOURS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 24 }}>
                {[
                  { value: statsFallback(stats.affiliatedServers), label: "SERVEURS" },
                  { value: statsFallback(stats.affiliatedChannels), label: "CHANNELS" },
                  { value: statsFallback(stats.messagesLast30Days), label: "MESSAGES" },
                  { value: statsFallback(stats.relayedMessagesLast30Days), label: "RELAIS" },
                ].map((s) => (
                  <div key={s.label}>
                    <div className="num" style={{ fontSize: 32, color: "var(--blue-500)" }}>
                      {s.value}
                    </div>
                    <div className="mono" style={{ color: "var(--ink-mute)", fontSize: 10, letterSpacing: "0.18em" }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </CyberCard>
          </div>
        </section>

        <section className="container" style={{ paddingBottom: 80 }}>
          <div className="section-head">
            <h2>Fonctionnalités</h2>
            <div className="meta">{FEATURES.length} MODULES</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {FEATURES.map((f) => (
              <CyberCard lift key={f.title}>
                <div className="eyebrow" style={{ color: "var(--blue-300)" }}>
                  {f.tag}
                </div>
                <h3 className="display" style={{ fontSize: 22, margin: "8px 0" }}>
                  {f.title}
                </h3>
                <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>
                  {f.desc}
                </p>
              </CyberCard>
            ))}
          </div>
        </section>

        <section className="container" style={{ paddingBottom: 80 }}>
          <div className="section-head">
            <h2>Commandes</h2>
            <div className="meta">PRÉFIXE /</div>
          </div>
          <CyberCard style={{ padding: 0, overflow: "hidden" }}>
            {COMMANDS.map((c, i) => (
              <div
                key={c.cmd}
                style={{
                  display: "grid",
                  gridTemplateColumns: "180px 1fr",
                  padding: "14px 20px",
                  borderBottom: i < COMMANDS.length - 1 ? "1px solid var(--line-soft)" : "none",
                }}
              >
                <code className="mono" style={{ color: "var(--blue-300)" }}>
                  {c.cmd}
                </code>
                <span style={{ color: "var(--ink-mute)" }}>
                  {c.desc}
                </span>
              </div>
            ))}
          </CyberCard>
        </section>
      </main>

      <PublicFooter />
    </PageWithPalette>
  );
}
