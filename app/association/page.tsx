import type { Metadata } from "next";
import Link from "next/link";
import { PageWithPalette } from "@/components/page-with-palette";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { AboutSection } from "@/components/cyber/landing/AboutSection";
import { CyberCard, CyberButton, TeamSigil } from "@/components/cyber";

export const metadata: Metadata = {
  title: "BlueGenji - L'Association Esport",
  description: "BlueGenji, association loi 1901 au service de la scène amateur française pour Overwatch 2 et Marvel Rivals.",
  openGraph: {
    title: "BlueGenji - L'Association",
    description: "Structure associative compétitive et inclusive pour la scène esport francophone.",
    type: "website",
    locale: "fr_FR",
  },
};

export default function AssociationPage() {
  return (
    <PageWithPalette palette="gold">
      <main className="page-shell" style={{ position: "relative", zIndex: 1 }}>
        <PublicHeader />

        {/* ── HERO ── */}
        <section className="container" style={{ padding: "80px 0 40px" }}>
          <div className="fabric" />
          <div className="section-head">
            <div>
              <div className="eyebrow">L'ASSOCIATION · LOI 1901</div>
              <h1 className="display" style={{ fontSize: 64 }}>
                Au service de la scène amateur française.
              </h1>
            </div>
            <div className="mono" style={{ color: "var(--ink-mute)" }}>
              FONDÉE EN 2023 · SIÈGE LYON
            </div>
          </div>
        </section>

        {/* ── ABOUT SECTION ── */}
        <AboutSection />

        {/* ── MANIFESTO ── */}
        <section className="container" style={{ paddingBottom: 80 }}>
          <div className="section-head">
            <h2>Manifeste</h2>
            <div className="meta">CE QUI NOUS DÉFINIT</div>
          </div>
          <CyberCard ticks className="manifesto-card">
            <p style={{ color: "var(--ink-1)", lineHeight: 1.8, marginBottom: 16, fontSize: 15 }}>
              BlueGenji est née de la conviction que la compétition esport en ligne doit être accessible, transparente et rémunératrice pour tous. Nous créons des tournois de qualité broadcast, gérés par une communauté de bénévoles passionnés qui croient à l'équité et l'inclusion.
            </p>
            <p style={{ color: "var(--ink-1)", lineHeight: 1.8, marginBottom: 16, fontSize: 15 }}>
              Nos cash prizes sont réinvestis directement depuis les frais d'inscription — pas de marge marketing, pas de rétention. Chaque euro engagé revient aux joueurs et équipes qui gagnent, sans exception. Nous ne demandons qu'une adhésion gratuite pour participer, car le talent n'a pas de portefeuille.
            </p>
            <p style={{ color: "var(--ink-1)", lineHeight: 1.8, marginBottom: 16, fontSize: 15 }}>
              L'arbitrage est rigoureux, les brackets sont publics et audités, et les décisions sont justifiées. Nous n'avons pas de relation d'argent avec les équipes — juste une obligation morale de compétition saine. Notre neutralité politique est absolue : nous accueillons toute scène de jeu compétitif qui partage nos valeurs.
            </p>
            <p style={{ color: "var(--ink-1)", lineHeight: 1.8, marginBottom: 16, fontSize: 15 }}>
              BlueGenji c'est aussi une communauté. Casters, coaches, modérateurs, organisateurs — chacun a sa place pour contribuer à construire une scène francophone où le talent ne suffit pas, où le respect et l'entraide font la différence. Nous ne sommes pas en compétition avec les autres structures : nous apprenons les uns des autres et grandissons ensemble.
            </p>
            <p style={{ color: "var(--ink-1)", lineHeight: 1.8, fontSize: 15 }}>
              Nos tournois parlent d'eux-mêmes. Overwatch 2 depuis la création, Marvel Rivals en croissance, formats simples et double élimination, du débutant au semi-pro. Chaque équipe joue pour la même chose : la victoire, le respect, et le prix qu'elle a gagné.
            </p>
          </CyberCard>
        </section>

        {/* ── BUREAU ── */}
        <section className="container" style={{ paddingBottom: 80 }}>
          <div className="section-head">
            <h2>Bureau</h2>
            <div className="meta">4 MEMBRES</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
            {BUREAU.map((b) => (
              <CyberCard key={b.name} lift>
                <TeamSigil letter={b.initials} color={b.color} />
                <h3 style={{ marginBottom: 8, marginTop: 16 }}>{b.name}</h3>
                <div className="mono" style={{ color: "var(--ink-mute)", fontSize: 12, marginBottom: 12 }}>
                  {b.role}
                </div>
              </CyberCard>
            ))}
          </div>
        </section>

        {/* ── ADHÉRER ── */}
        <section className="container" style={{ paddingBottom: 80 }}>
          <div className="section-head">
            <h2>Adhérer</h2>
            <div className="meta">GRATUIT · SANS ENGAGEMENT</div>
          </div>
          <CyberCard ticks style={{ padding: 48 }}>
            <p style={{ color: "var(--ink-1)", lineHeight: 1.8, marginBottom: 24, fontSize: 15 }}>
              L'adhésion à BlueGenji vous ouvre l'accès complet à tous nos tournois, événements et ressources communautaires. C'est gratuit, sans engagement et sans limite de durée. Il suffit de créer un compte pour commencer.
            </p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <CyberButton variant="primary" asChild>
                <Link href="/connexion">Créer un compte →</Link>
              </CyberButton>
              <CyberButton variant="ghost" asChild>
                <a href="https://discord.gg/bluegenji" target="_blank" rel="noreferrer">
                  Rejoindre le Discord
                </a>
              </CyberButton>
            </div>
          </CyberCard>
        </section>

        {/* ── DOCUMENTS ── */}
        <section className="container" style={{ paddingBottom: 80 }}>
          <div className="section-head">
            <h2>Documents</h2>
            <div className="meta">TÉLÉCHARGEABLES</div>
          </div>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
            <li>
              <Link href="/statuts.pdf" style={{ color: "var(--accent-blue)", textDecoration: "none" }}>
                Statuts (PDF) →
              </Link>
            </li>
            <li>
              <Link href="/reglement-interieur.pdf" style={{ color: "var(--accent-blue)", textDecoration: "none" }}>
                Règlement intérieur →
              </Link>
            </li>
            <li>
              <Link href="/rapport-moral-2025.pdf" style={{ color: "var(--accent-blue)", textDecoration: "none" }}>
                Rapport moral 2025 →
              </Link>
            </li>
          </ul>
          <div className="mono" style={{ color: "var(--ink-dim)", marginTop: 24 }}>
            SIRET 912 345 678 00017 · RNA W691234567
          </div>
        </section>

        <PublicFooter />
      </main>
    </PageWithPalette>
  );
}

const BUREAU = [
  {
    name: "Léo Perreaut",
    role: "Président",
    initials: "LP",
    color: "rgb(89, 212, 255)",
  },
  {
    name: "Bryan Boulleaux",
    role: "Trésorier",
    initials: "BB",
    color: "rgb(245, 195, 58)",
  },
  {
    name: "Sophie Martin",
    role: "Secrétaire",
    initials: "SM",
    color: "rgb(255, 157, 46)",
  },
  {
    name: "Jérôme Dubois",
    role: "Responsable arbitrage",
    initials: "JD",
    color: "rgb(167, 115, 255)",
  },
];
