import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import Link from "next/link";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { CyberButton } from "@/components/cyber";
import styles from "./page.module.css";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { SITE_HOST } from "@/lib/shared/site-host";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { LOGO_QUARANTINE_DAYS } from "@/lib/shared/logo-quarantine";

/**
 * Lien externe vers le règlement intérieur (Google Docs).
 * Centralisé ici et dans les autres surfaces qui exposent le document
 * (footer, page association). Voir `docs/features/LEGAL_PAGE.md`.
 */
const REGLEMENT_URL =
  "https://docs.google.com/document/d/1f3X3tbgs0U7Gwz0qSfotgW-HqMLKIb6DUKqlbz-ZCq8/preview";

export const metadata: Metadata = pageMetadata({
  title: "Mentions légales",
  description:
    "Mentions légales de la plateforme BlueGenji Esport, éditée par l'association Bluegenji Esport (loi 1901).",
  shareDescription: "Éditeur, hébergement, propriété intellectuelle et données personnelles.",
  path: "/mentions-legales",
});

export default function MentionsLegalesPage() {
  return (
    <PublicPageShell>
      {/* HERO */}
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">LÉGAL · LOI 1901</span>
        <div className={styles.heroGrid}>
          <div>
            <h1 className={`display ${styles.heroTitle}`}>Mentions légales</h1>
          </div>
          {/* Un `<div>` : même raison que sur `/association` — un `<aside>` dans
              `<main>` n'est pas un repère de premier niveau (RGAA 12.6). */}
          <div className={styles.heroSide}>
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
              <span style={{ fontSize: 17 }}>Septembre 2026</span>
            </div>
          </div>
        </div>
      </section>

      {SECTIONS.map((section, index) => (
        <section
          key={section.title}
          id={section.id}
          className={styles.section}
          style={{ scrollMarginTop: 96 }}
        >
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
            <a
              href="/statuts.pdf"
              target="_blank"
              rel="noreferrer"
              className={styles.docItem}
              aria-label="Statuts de l'association (PDF, nouvel onglet)"
            >
              <span>Statuts de l&apos;association</span>
              <span className={styles.docMeta}>PDF →</span>
            </a>
          </li>
          <li>
            <a
              href={REGLEMENT_URL}
              target="_blank"
              rel="noreferrer"
              className={styles.docItem}
              aria-label="Règlement intérieur (Google Docs, nouvel onglet)"
            >
              <span>Règlement intérieur</span>
              <span className={styles.docMeta}>DOC →</span>
            </a>
          </li>
          <li>
            <a
              href="/bulletin_adhesion.docx"
              download
              className={styles.docItem}
              aria-label="Bulletin d'adhésion (DOCX, téléchargement)"
            >
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
    </PublicPageShell>
  );
}

const SECTIONS: { title: string; meta: string; body: React.ReactNode; id?: string }[] = [
  {
    title: "Éditeur du site",
    meta: "RESPONSABLE DE LA PUBLICATION",
    body: (
      <>
        <p>
          La plateforme est éditée par l&apos;association{" "}
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
          <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
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
    id: "hebergement",
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
          <strong>{SITE_HOST.name}</strong> — {SITE_HOST.status}
          <br />
          {SITE_HOST.address}
          <br />
          Téléphone : {SITE_HOST.phone}
          <br />
          SIREN : {SITE_HOST.siren}
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
          Les éléments propres au site — textes éditoriaux, logo et identité visuelle de
          l&apos;association, mise en page, code — sont la propriété de l&apos;association Bluegenji
          Esport. Leur reproduction, représentation, modification ou diffusion, totale ou partielle,
          est interdite sans son autorisation écrite préalable.
        </p>
        <p>
          <strong>Ne lui appartiennent pas</strong> les contenus publiés par les membres (avatars,
          logos, noms et descriptions d&apos;équipe, pseudos), qui restent la propriété de leurs
          auteurs ou de leurs titulaires, ni les marques et visuels des jeux Overwatch (Blizzard
          Entertainment) et Marvel Rivals (NetEase, Marvel), qui appartiennent à leurs titulaires.
          Le site n&apos;est affilié à aucun de ces éditeurs.
        </p>
      </>
    ),
  },
  {
    id: "contenus-membres",
    title: "Contenus des membres et signalement",
    meta: "HÉBERGEUR · DSA ART. 16",
    body: (
      <>
        <p>
          Pour les contenus que publient ses membres, l&apos;association agit en qualité
          d&apos;<strong>hébergeur</strong> (loi pour la confiance dans l&apos;économie numérique,
          art. 6 ; règlement européen sur les services numériques, art. 6) : elle ne les contrôle pas
          avant publication, et chaque membre garantit détenir les droits sur ce qu&apos;il publie,
          comme le prévoient les{" "}
          <Link href={TERMS_PATH}>conditions d&apos;utilisation</Link>.
        </p>
        <p>
          <strong>Toute personne</strong>, membre ou non, peut signaler un contenu illicite — une
          atteinte au droit d&apos;auteur notamment — par le bouton <strong>« Signaler un
          problème »</strong> présent en bas de chaque page. Le signalement d&apos;un droit
          d&apos;auteur indique le nom et l&apos;adresse de son auteur, sa qualité, le contenu visé
          et la raison de la demande.
        </p>
        <p>
          Un logo signalé peut être <strong>masqué</strong> sans délai : il cesse d&apos;être en
          ligne, et l&apos;équipe en est prévenue. Elle dispose alors de{" "}
          <strong>{LOGO_QUARANTINE_DAYS / 30} mois</strong> pour contester depuis la page du
          signalement ; sans contestation, le logo est supprimé définitivement, et si la
          contestation aboutit, il est rétabli. Le détail du traitement de vos données dans ce
          cadre figure dans la <Link href="/rgpd#signalements">politique de confidentialité</Link>.
        </p>
      </>
    ),
  },
  {
    id: "donnees-personnelles",
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
          serveur Discord. Le détail des traitements, leurs durées et leur registre figurent dans la{" "}
          <Link href="/rgpd">politique de confidentialité</Link>.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    meta: "COOKIES TECHNIQUES",
    body: (
      <>
        <p>
          Le site n&apos;utilise que des cookies <strong>techniques</strong> : la session d&apos;un
          membre connecté, l&apos;état d&apos;une connexion en cours, vos réglages
          d&apos;accessibilité et le souvenir des annonces de recrutement déjà vues. Aucun ne permet
          de suivi publicitaire. Leur liste complète, avec leur durée, figure dans la{" "}
          <Link href="/rgpd#cookies">politique de confidentialité</Link>.
        </p>
        <p>
          Aucun traceur publicitaire ni outil de mesure d&apos;audience externe n&apos;est utilisé.
          Seule exception, sur la page de connexion et après votre accord : l&apos;invite de
          connexion de Google peut déposer un cookie <code>g_state</code>. La communication entre
          votre navigateur et le serveur est chiffrée (HTTPS).
        </p>
      </>
    ),
  },
];
