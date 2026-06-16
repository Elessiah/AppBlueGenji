import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { CyberButton } from "@/components/cyber";
import styles from "./page.module.css";

const REGLEMENT_URL =
  "https://docs.google.com/document/d/1f3X3tbgs0U7Gwz0qSfotgW-HqMLKIb6DUKqlbz-ZCq8/edit?usp=sharing";

export const metadata: Metadata = {
  title: "BlueGenji - Mentions légales",
  description:
    "Mentions légales de la plateforme BlueGenji Arena, éditée par l'association Bluegenji Esport (loi 1901).",
  openGraph: {
    title: "BlueGenji - Mentions légales",
    description: "Éditeur, hébergement, propriété intellectuelle et données personnelles.",
    type: "website",
    locale: "fr_FR",
  },
};

export default function MentionsLegalesPage() {
  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />

      {/* HERO */}
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">LÉGAL · LOI 1901</span>
        <div className={styles.heroGrid}>
          <div>
            <h1 className={`display ${styles.heroTitle}`}>Mentions légales</h1>
          </div>
          <aside className={styles.heroSide}>
            <div className={styles.heroFact}>
              <span className={styles.heroFactLabel}>ÉDITEUR</span>
              <span style={{ fontSize: 17 }}>Bluegenji Esport</span>
            </div>
            <div className={styles.heroFact}>
              <span className={styles.heroFactLabel}>STATUT</span>
              <span style={{ fontSize: 17 }}>Association loi 1901</span>
            </div>
            <div className={styles.heroFact}>
              <span className={styles.heroFactLabel}>MISE À JOUR</span>
              <span style={{ fontSize: 17 }}>Juin 2026</span>
            </div>
          </aside>
        </div>
      </section>

      {SECTIONS.map((section, index) => (
        <section key={section.title} className={styles.section}>
          <header className={styles.head}>
            <div>
              <span className="eyebrow">SECTION {String(index + 1).padStart(2, "0")}</span>
              <h2 className={styles.sectionTitle}>{section.title}</h2>
            </div>
            <span className={styles.meta}>{section.meta}</span>
          </header>
          <div className={styles.prose}>{section.body}</div>
        </section>
      ))}

      {/* DOCUMENTS */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION {String(SECTIONS.length + 1).padStart(2, "0")}</span>
            <h2 className={styles.sectionTitle}>Documents officiels</h2>
          </div>
          <span className={styles.meta}>STATUTS · ADHÉSION</span>
        </header>
        <ul className={styles.docList}>
          <li>
            <a href="/statuts.pdf" target="_blank" rel="noreferrer" className={styles.docItem}>
              <span>Statuts de l&apos;association</span>
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
            <a href="/bulletin_adhesion.docx" target="_blank" rel="noreferrer" className={styles.docItem}>
              <span>Bulletin d&apos;adhésion</span>
              <span className={styles.docMeta}>DOCX →</span>
            </a>
          </li>
        </ul>
        <div className={styles.ctaRow}>
          <CyberButton variant="ghost" asChild>
            <Link href="/association">En savoir plus sur l&apos;association →</Link>
          </CyberButton>
        </div>
        <div className={styles.legal}>
          Bluegenji Esport · Association loi 1901 · Siège social : 4 impasse des Cyprès, 51210 Janvilliers
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

const SECTIONS: { title: string; meta: string; body: React.ReactNode }[] = [
  {
    title: "Éditeur du site",
    meta: "RESPONSABLE DE LA PUBLICATION",
    body: (
      <>
        <p>
          La plateforme BlueGenji Arena est éditée par l&apos;association{" "}
          <strong>Bluegenji Esport</strong>, association à but non lucratif régie par la loi du
          1<sup>er</sup> juillet 1901 et le décret du 16 août 1901.
        </p>
        <p>
          <strong>Siège social :</strong> 4 impasse des Cyprès, 51210 Janvilliers, France.
        </p>
        <p>
          <strong>Objet :</strong> organisation d&apos;événements et de tournois esport en ligne et
          en LAN, fédération des équipes participantes, formation et mise en avant des acteurs de la
          scène, ainsi que la retransmission en direct des événements et tournois.
        </p>
        <p>
          <strong>Contact :</strong> via le serveur{" "}
          <a href="https://discord.gg/bluegenji" target="_blank" rel="noreferrer">
            Discord de l&apos;association
          </a>
          .
        </p>
      </>
    ),
  },
  {
    title: "Directeur de la publication",
    meta: "PRÉSIDENT",
    body: (
      <p>
        Le directeur de la publication est <strong>Léo Perreaut</strong>, en sa qualité de Président
        de l&apos;association Bluegenji Esport.
      </p>
    ),
  },
  {
    title: "Hébergement",
    meta: "HÉBERGEUR",
    body: (
      <>
        <p>
          Le site est hébergé sur le même serveur que{" "}
          <a href="https://celine-houssin.fr" target="_blank" rel="noreferrer">
            celine-houssin.fr
          </a>
          , par :
        </p>
        <p>
          <strong>Keryan Houssin</strong> — Auto-entrepreneur
          <br />
          13 rue du Chemin Fourchue, 14000 Caen, France
          <br />
          Téléphone : 06 02 22 49 56
          <br />
          SIREN : 930 888 342
        </p>
      </>
    ),
  },
  {
    title: "Propriété intellectuelle",
    meta: "DROITS RÉSERVÉS",
    body: (
      <>
        <p>
          L&apos;ensemble des éléments composant le site (textes, logos, images, éléments graphiques,
          mise en page) est la propriété exclusive de l&apos;association Bluegenji Esport, sauf
          mention contraire.
        </p>
        <p>
          Toute reproduction, représentation, modification ou diffusion, totale ou partielle, est
          strictement interdite sans autorisation écrite préalable de l&apos;association.
        </p>
      </>
    ),
  },
  {
    title: "Données personnelles",
    meta: "RGPD · RÈGLEMENT UE 2016/679",
    body: (
      <>
        <p>
          Les informations recueillies lors de la création d&apos;un compte ou d&apos;une adhésion
          sont nécessaires à la gestion de votre participation aux activités de l&apos;association.
          Elles sont destinées exclusivement à l&apos;association Bluegenji Esport et ne sont en
          aucun cas cédées à des tiers.
        </p>
        <p>
          Conformément au Règlement Général sur la Protection des Données (RGPD — Règlement UE
          2016/679), vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement
          et de portabilité des données vous concernant, ainsi que d&apos;un droit d&apos;opposition
          au traitement. Ces droits peuvent être exercés en contactant l&apos;association via son
          serveur Discord.
        </p>
      </>
    ),
  },
  {
    title: "Cookies",
    meta: "COOKIES STRICTEMENT NÉCESSAIRES",
    body: (
      <>
        <p>
          Le site utilise uniquement un cookie de session strictement nécessaire à son
          fonctionnement, destiné à maintenir votre authentification une fois connecté. Ce cookie ne
          permet aucun suivi publicitaire.
        </p>
        <p>
          Aucun cookie tiers, traceur publicitaire ou outil de mesure d&apos;audience externe
          n&apos;est utilisé. La communication entre votre navigateur et le serveur est sécurisée
          via le protocole HTTPS.
        </p>
      </>
    ),
  },
];
