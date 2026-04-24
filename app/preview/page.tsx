"use client";

import {
  Pill,
  CyberCard,
  CyberButton,
  TeamSigil,
  CountdownStrip,
  Ticker,
  MiniBracket,
} from "@/components/cyber";

export default function CyberPreview() {
  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const targetISO = in3Days.toISOString();

  const tickerItems = [
    "RÉSULTAT · Genji Clash #14 · Neon Drift 3 — Kairos 1",
    "INSCRIPTIONS · Monthly Cup Mai · 7/8 équipes",
    "PARTENARIAT · BlueGenji × Logitech G — annonce le 30.04",
    "RECRUTEMENT · Staff arbitrage Marvel Rivals",
    "DISCORD · 4 212 membres · +184 cette semaine",
  ];

  const bracketMatches = [
    { a: "Neon Drift", b: "Static Wolves", sa: 2, sb: 1 },
    { a: "Kairos", b: "Ion Break", sa: 3, sb: 0 },
    { a: "Void Pulse", b: "Blue Hour", sa: 1, sb: 2 },
    { a: "Paper Tigers", b: "Midnight Koi", sa: "—", sb: "—" },
  ];

  return (
    <div
      style={{
        backgroundColor: "var(--cyber-bg)",
        color: "var(--ink)",
        minHeight: "100vh",
        padding: "48px 24px",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "48px" }}>
        {/* Pills */}
        <section>
          <h2 style={{ fontSize: "24px", marginBottom: "16px" }}>Pills</h2>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <Pill>BETA</Pill>
            <Pill variant="live">LIVE EN COURS</Pill>
            <Pill variant="blue">OW2</Pill>
          </div>
        </section>

        {/* Buttons */}
        <section>
          <h2 style={{ fontSize: "24px", marginBottom: "16px" }}>Buttons</h2>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <CyberButton variant="primary">Inscrire mon équipe</CyberButton>
            <CyberButton variant="ghost">Voir le bracket</CyberButton>
          </div>
        </section>

        {/* Team Sigils */}
        <section>
          <h2 style={{ fontSize: "24px", marginBottom: "16px" }}>Team Sigils</h2>
          <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
            <TeamSigil letter="N" color="var(--blue-500)" size={40} />
            <TeamSigil letter="S" color="var(--amber)" size={40} />
            <TeamSigil letter="K" color="#8fd5ff" size={40} />
            <TeamSigil letter="V" color="#b4c8d4" size={40} />
          </div>
        </section>

        {/* Cards */}
        <section>
          <h2 style={{ fontSize: "24px", marginBottom: "16px" }}>Cards</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "24px",
            }}
          >
            <CyberCard style={{ padding: "24px" }}>
              <h3 style={{ fontSize: "18px", marginBottom: "8px" }}>Default Card</h3>
              <p style={{ color: "var(--ink-mute)", margin: 0 }}>
                Carte cyber-minimal sans options.
              </p>
            </CyberCard>

            <CyberCard lift style={{ padding: "24px" }}>
              <h3 style={{ fontSize: "18px", marginBottom: "8px" }}>With Lift</h3>
              <p style={{ color: "var(--ink-mute)", margin: 0 }}>
                Soulevée au survol (lift=true).
              </p>
            </CyberCard>

            <CyberCard ticks style={{ padding: "24px" }}>
              <h3 style={{ fontSize: "18px", marginBottom: "8px" }}>With Ticks</h3>
              <p style={{ color: "var(--ink-mute)", margin: 0 }}>
                Coins cyan visibles (ticks=true).
              </p>
            </CyberCard>

            <CyberCard lift ticks style={{ padding: "24px" }}>
              <h3 style={{ fontSize: "18px", marginBottom: "8px" }}>Combined</h3>
              <p style={{ color: "var(--ink-mute)", margin: 0 }}>
                Lift + Ticks pour l'effet complet.
              </p>
            </CyberCard>
          </div>
        </section>

        {/* Countdown Strip */}
        <section>
          <h2 style={{ fontSize: "24px", marginBottom: "16px" }}>Countdown Strip</h2>
          <CyberCard style={{ padding: 0 }}>
            <CountdownStrip targetISO={targetISO} label="PROCHAIN TOURNOI · OUVERTURE DES INSCRIPTIONS" />
          </CyberCard>
        </section>

        {/* Ticker */}
        <section>
          <h2 style={{ fontSize: "24px", marginBottom: "16px" }}>Ticker</h2>
          <Ticker items={tickerItems} />
        </section>

        {/* Mini Bracket */}
        <section>
          <h2 style={{ fontSize: "24px", marginBottom: "16px" }}>Mini Bracket</h2>
          <CyberCard style={{ padding: "24px" }}>
            <MiniBracket matches={bracketMatches} />
          </CyberCard>
        </section>
      </div>
    </div>
  );
}
