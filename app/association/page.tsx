import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { AboutSection } from "@/components/cyber/landing/AboutSection";
import { CyberButton } from "@/components/cyber";
import { getCurrentUser } from "@/lib/server/auth";
import { listBureauMembers } from "@/lib/server/bureau-service";
import { getPressEmail } from "@/lib/server/contact-service";
import { BureauSection } from "./BureauSection";
import { ContactSection } from "./ContactSection";
import styles from "./page.module.css";

const REGLEMENT_URL =
  "https://docs.google.com/document/d/1f3X3tbgs0U7Gwz0qSfotgW-HqMLKIb6DUKqlbz-ZCq8/preview";

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

export default async function AssociationPage() {
  const [user, bureauMembers, pressEmail] = await Promise.all([
    getCurrentUser(),
    listBureauMembers(),
    getPressEmail(),
  ]);
  const isAdmin = Boolean(user?.isAdmin);

  return (
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
        <section id="manifeste" className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">SECTION 04</span>
              <h2 className={styles.sectionTitle}>Manifeste</h2>
            </div>
            <span className={styles.meta}>CE QUI NOUS DÉFINIT</span>
          </header>
          <div className={styles.manifesteGrid}>
            <p className={styles.lede}>
              BlueGenji est née de la conviction que l&apos;esport amateur mérite une scène fiable, ouverte et sérieuse — où chacun trouve sa place, quel que soit son niveau.
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
        <BureauSection initialMembers={bureauMembers} isAdmin={isAdmin} />

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
              <a href="/statuts.pdf" target="_blank" rel="noreferrer" className={styles.docItem}>
                <span>Statuts de l'association</span>
                <span className={styles.docMeta}>PDF →</span>
              </a>
            </li>
            <li>
              <a href={REGLEMENT_URL} target="_blank" rel="noreferrer" className={styles.docItem}>
                <span>Règlement intérieur</span>
                <span className={styles.docMeta}>DOC →</span>
              </a>
            </li>
            <li>
              <a href="/bulletin_adhesion.docx" download className={styles.docItem}>
                <span>Bulletin d&apos;adhésion</span>
                <span className={styles.docMeta}>DOCX →</span>
              </a>
            </li>
          </ul>
          <div className={styles.legal}>
            SIRET 912 345 678 00017 · RNA W691234567
          </div>
        </section>

        {/* CONTACT PRESSE */}
        <ContactSection initialEmail={pressEmail} isAdmin={isAdmin} />

        <PublicFooter />
      </main>
  );
}

const MANIFESTE = [
  {
    title: "Raison d'être",
    text: "Animer la scène esport amateur en créant des événements compétitifs ouverts à tous. Là où d'autres organisent pour une élite, nous bâtissons des rendez-vous réguliers où chacun peut jouer, progresser et se mesurer aux autres.",
  },
  {
    title: "Valeurs",
    text: "L'inclusivité et l'ouverture d'esprit. Nous ne jugeons les joueurs sur rien d'autre que leur respect et leurs qualités de jeu — origine, niveau ou profil ne ferment jamais une porte.",
  },
  {
    title: "Vision",
    text: "Une scène fiable, éthique et durable où tout le monde trouve sa place, à n'importe quel niveau : pour s'amuser dans un contexte plus sérieux, ou tenter l'ascension vers le monde professionnel.",
  },
  {
    title: "Engagement",
    text: "Un encadrement sérieux, une activité nourrie et la volonté sincère de construire un environnement à la fois sain et compétitif. Nous prenons cet engagement au sérieux à chaque tournoi.",
  },
];
