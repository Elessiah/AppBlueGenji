import type { Metadata } from "next";
import Link from "next/link";
import { PageWithPalette } from "@/components/page-with-palette";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { AboutSection } from "@/components/cyber/landing/AboutSection";
import { CyberCard, CyberButton, TeamSigil } from "@/components/cyber";
import styles from "./page.module.css";

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
      <main style={{ position: "relative", zIndex: 1 }}>
        <PublicHeader />

        {/* HERO */}
        <section className={`${styles.section} ${styles.heroSection}`}>
          <div className="fabric" />
          <span className="eyebrow">L'ASSOCIATION · LOI 1901</span>
          <div className={styles.heroGrid}>
            <div>
              <h1 className={`display ${styles.heroTitle}`}>
                Au service de la scène<br />
                amateur française.
              </h1>
            </div>
            <aside className={styles.heroSide}>
              <div className={styles.heroFact}>
                <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 10, letterSpacing: "0.2em" }}>
                  FONDÉE EN
                </span>
                <span className="num" style={{ fontSize: 28 }}>2023</span>
              </div>
              <div className={styles.heroFact}>
                <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 10, letterSpacing: "0.2em" }}>
                  SIÈGE
                </span>
                <span style={{ fontSize: 17 }}>Lyon</span>
              </div>
              <div className={styles.heroFact}>
                <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 10, letterSpacing: "0.2em" }}>
                  STATUT
                </span>
                <span style={{ fontSize: 17 }}>Association loi 1901</span>
              </div>
            </aside>
          </div>
        </section>

        {/* ABOUT SECTION */}
        <AboutSection />

        {/* MANIFESTE */}
        <section className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">SECTION 04</span>
              <h2 className={styles.sectionTitle}>Manifeste</h2>
            </div>
            <span className={styles.meta}>CE QUI NOUS DÉFINIT</span>
          </header>
          <div className={styles.manifesteGrid}>
            <p className={styles.lede}>
              BlueGenji est née de la conviction que la compétition esport en ligne doit être accessible, transparente et rémunératrice pour tous.
            </p>
            <ol className={styles.principles}>
              {MANIFESTE.map((item, index) => (
                <li key={item.title} className={styles.principle}>
                  <span className={`mono ${styles.principleNum}`}>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className={styles.principleTitle}>{item.title}</h3>
                    <p className={styles.principleText}>{item.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* BUREAU */}
        <section className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">SECTION 05</span>
              <h2 className={styles.sectionTitle}>Bureau</h2>
            </div>
            <span className={styles.meta}>4 MEMBRES · BÉNÉVOLES</span>
          </header>
          <div className={styles.bureauGrid}>
            {BUREAU.map((b) => (
              <CyberCard key={b.name} lift className={styles.bureauCard}>
                <div className={styles.bureauSigil}>
                  <TeamSigil letter={b.initials} color={b.color} size={40} />
                </div>
                <div className={styles.bureauDivider} />
                <div>
                  <h3 className={styles.bureauName}>{b.name}</h3>
                  <p className={styles.bureauRole}>{b.role}</p>
                </div>
              </CyberCard>
            ))}
          </div>
        </section>

        {/* ADHÉRER */}
        <section className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">SECTION 06</span>
              <h2 className={styles.sectionTitle}>Adhérer</h2>
            </div>
            <span className={styles.meta}>GRATUIT · SANS ENGAGEMENT</span>
          </header>
          <div className={styles.adhererGrid}>
            <div className={styles.adhererText}>
              <p className={styles.lede}>
                L&apos;adhésion vous ouvre l&apos;accès complet à tous nos tournois, événements et ressources communautaires.
              </p>
              <p className={styles.adhererBody}>
                Gratuit, sans engagement, sans limite de durée. Il suffit de créer un compte pour commencer.
              </p>
            </div>
            <aside className={styles.adhererSide}>
              <div className={styles.adhererPerks}>
                {[
                  ["00 €", "Cotisation"],
                  ["48 h", "Validation moyenne"],
                  ["∞", "Tournois inclus"],
                ].map(([value, label]) => (
                  <div key={label} className={styles.adhererPerk}>
                    <span className={`num ${styles.adhererPerkValue}`}>{value}</span>
                    <span className="mono">{label}</span>
                  </div>
                ))}
              </div>
              <div className={styles.ctaRow}>
                <CyberButton variant="primary" asChild>
                  <Link href="/connexion">Créer un compte →</Link>
                </CyberButton>
                <CyberButton variant="ghost" asChild>
                  <a href="https://discord.gg/bluegenji" target="_blank" rel="noreferrer">
                    Rejoindre le Discord
                  </a>
                </CyberButton>
              </div>
            </aside>
          </div>
        </section>

        {/* DOCUMENTS */}
        <section className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">SECTION 07</span>
              <h2 className={styles.sectionTitle}>Documents</h2>
            </div>
            <span className={styles.meta}>TÉLÉCHARGEABLES</span>
          </header>
          <ul className={styles.docList}>
            <li>
              <Link href="/statuts.pdf" className={styles.docItem}>
                <span>Statuts de l'association</span>
                <span className={styles.docMeta}>PDF · 142 KO →</span>
              </Link>
            </li>
            <li>
              <Link href="/reglement-interieur.pdf" className={styles.docItem}>
                <span>Règlement intérieur</span>
                <span className={styles.docMeta}>PDF · 89 KO →</span>
              </Link>
            </li>
            <li>
              <Link href="/rapport-moral-2025.pdf" className={styles.docItem}>
                <span>Rapport moral 2025</span>
                <span className={styles.docMeta}>PDF · 156 KO →</span>
              </Link>
            </li>
          </ul>
          <div className={styles.legal}>
            SIRET 912 345 678 00017 · RNA W691234567
          </div>
        </section>

        <PublicFooter />
      </main>
    </PageWithPalette>
  );
}

const MANIFESTE = [
  {
    title: "Transparence",
    text: "Cash prizes réinvestis depuis les frais d'inscription, brackets publics et audités, décisions justifiées. Pas de marge marketing, pas de rétention.",
  },
  {
    title: "Accessibilité",
    text: "Adhésion gratuite à vie pour participer. Le talent n'a pas de portefeuille — chaque euro engagé revient aux joueurs et équipes qui gagnent.",
  },
  {
    title: "Arbitrage",
    text: "Aucune relation d'argent avec les équipes, juste une obligation morale de compétition saine. Neutralité politique absolue.",
  },
  {
    title: "Communauté",
    text: "Casters, coaches, modérateurs, organisateurs. Une scène francophone où le respect et l'entraide font la différence, jamais en compétition avec les autres structures.",
  },
  {
    title: "Multi-jeux",
    text: "Overwatch 2 depuis la création, Marvel Rivals en croissance. Doubles éliminations, rounds suisses, formats endurance — du débutant au semi-pro.",
  },
];

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
