import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import Link from "next/link";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { CyberButton } from "@/components/cyber";
import styles from "./page.module.css";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { SITE_HOST } from "@/lib/shared/site-host";
import {
  AUTHORITY_CONTACT_LANGUAGES,
  DATA_CONTACT_NAME,
  DATA_CONTACT_ROLE,
  REPORT_FORM_NAME,
} from "@/lib/shared/legal-contact";
import { NOTIFIER_FOLLOW_UP, copyrightNoticeElementsText } from "@/lib/shared/content-reports";
import {
  ASSOCIATION_EMAIL_ENCODED,
  ASSOCIATION_PHONE_ENCODED,
  DATA_CONTACT_EMAIL_ENCODED,
  DATA_CONTACT_PHONE_ENCODED,
} from "@/lib/shared/obfuscated-contact";
import { ProtectedContact } from "@/components/ui/protected-contact";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import {
  CODE_COPYRIGHT_HOLDER,
  CODE_LICENSE_NAME,
  CODE_LICENSE_SPDX,
  CODE_LICENSE_URL,
  SOURCE_CODE_URL,
} from "@/lib/shared/source-code";

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
          <strong>Immatriculation :</strong> l&apos;association ne dispose ni d&apos;un numéro RNA ni
          d&apos;un numéro SIREN.
        </p>
        <p>
          <strong>Objet :</strong> organisation d&apos;événements et de tournois esport en ligne et
          en LAN, fédération des équipes participantes, formation et mise en avant des acteurs de la
          scène, ainsi que la retransmission en direct des événements et tournois.
        </p>
        <p>
          <strong>Courriel :</strong>{" "}
          <ProtectedContact encoded={ASSOCIATION_EMAIL_ENCODED} kind="email" owner="de l'association" />
          <br />
          <strong>Téléphone :</strong>{" "}
          <ProtectedContact encoded={ASSOCIATION_PHONE_ENCODED} kind="phone" owner="de l'association" />
          <br />
          <strong>Discord :</strong>{" "}
          <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
            serveur de l&apos;association (nouvel onglet)
          </a>
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
    title: "Hébergement technique",
    meta: "HÉBERGEUR TECHNIQUE",
    body: (
      <>
        <p>
          Le site et le bot Discord de l&apos;association tournent sur {SITE_HOST.machine}, fourni
          et administré par son <strong>hébergeur technique</strong> :
        </p>
        <p>
          <strong>{SITE_HOST.name}</strong> — {SITE_HOST.status}
          <br />
          {SITE_HOST.address}
          <br />
          Téléphone :{" "}
          <ProtectedContact encoded={SITE_HOST.phoneEncoded} kind="phone" owner="de l'hébergeur" />
        </p>
        <p>
          L&apos;hébergeur technique fournit la machine. Il ne faut pas le confondre avec
          l&apos;association, qui est l&apos;<a href="#contenus-membres">hébergeur des contenus de
          ses utilisateurs</a> au sens du règlement européen sur les services numériques.
        </p>
        <p>
          Pour écrire à l&apos;hébergeur ou à l&apos;éditeur : bouton <strong>« {REPORT_FORM_NAME} »</strong>{" "}
          en bas de chaque page, catégorie « Hébergeur ».
        </p>
      </>
    ),
  },
  {
    id: "propriete-intellectuelle",
    title: "Propriété intellectuelle",
    meta: `CODE SOUS ${CODE_LICENSE_SPDX.toUpperCase()}`,
    body: (
      <>
        <p>
          <strong>Code source.</strong> Le code du site est publié sous la licence libre{" "}
          <a href={CODE_LICENSE_URL} target="_blank" rel="noreferrer">
            {CODE_LICENSE_NAME} (nouvel onglet)
          </a>{" "}
          ({CODE_LICENSE_SPDX}). Les droits d&apos;auteur sur ce code appartiennent à{" "}
          <strong>{CODE_COPYRIGHT_HOLDER}</strong>. Chacun peut le consulter, le copier, le
          modifier et le redistribuer aux conditions de cette licence, qui imposent notamment, pour une
          version modifiée offerte en ligne, d&apos;en proposer le code source à ses utilisateurs
          sous la même licence. Le code
          source est disponible sur{" "}
          <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
            GitHub (nouvel onglet)
          </a>
          . Il embarque des composants tiers — bibliothèques, polices — qui restent sous leurs
          propres licences.
        </p>
        <p>
          <strong>Autres éléments.</strong> Les textes éditoriaux, le nom, le logo et
          l&apos;identité visuelle de l&apos;association, ainsi que ses documents officiels, ne sont
          pas couverts par cette licence : leur reproduction, représentation, modification ou
          diffusion, totale ou partielle, suppose l&apos;autorisation de leurs titulaires.
        </p>
        <p>
          <strong>N&apos;appartiennent ni à l&apos;association ni à l&apos;auteur du code</strong>{" "}
          les contenus publiés par les utilisateurs (avatars, logos, noms et descriptions d&apos;équipe,
          pseudos), qui restent la propriété de leurs auteurs ou de leurs titulaires, ni les marques et visuels des jeux Overwatch (Blizzard
          Entertainment) et Marvel Rivals (NetEase, Marvel), qui appartiennent à leurs titulaires.
          Le site n&apos;est affilié à aucun de ces éditeurs.
        </p>
      </>
    ),
  },
  {
    id: "contenus-membres",
    title: "Contenus des utilisateurs et signalement",
    meta: "HÉBERGEUR DES CONTENUS · DSA ART. 16",
    body: (
      <>
        <p>
          Pour les contenus que publient ses utilisateurs, l&apos;association agit en qualité
          d&apos;<strong>hébergeur de ces contenus</strong> — distinct de l&apos;hébergeur
          technique, qui fournit la machine (loi pour la confiance dans l&apos;économie numérique,
          art. 6 ; règlement européen sur les services numériques, art. 6) : elle ne les contrôle pas
          avant publication, et chaque utilisateur garantit détenir les droits sur ce qu&apos;il publie,
          comme le prévoient les{" "}
          <Link href={TERMS_PATH}>conditions d&apos;utilisation</Link>.
        </p>
        <p>
          <strong>Toute personne</strong>, utilisateur ou non, peut signaler un contenu illicite — une
          atteinte au droit d&apos;auteur notamment — par le bouton <strong>« Signaler un
          problème »</strong> présent en bas de chaque page. Le signalement d&apos;un droit
          d&apos;auteur indique {copyrightNoticeElementsText()}. {NOTIFIER_FOLLOW_UP}
        </p>
        <p>
          Un logo d&apos;équipe ou un avatar de joueur signalé peut être <strong>masqué</strong>{" "}
          sans délai : il cesse d&apos;être en ligne, et l&apos;équipe ou le joueur en est prévenu.
          Il ou elle dispose alors de <strong>{LOGO_QUARANTINE_MONTHS} mois</strong> pour
          contester depuis la page du signalement ; sans contestation, l&apos;image est supprimée
          définitivement, et si la contestation aboutit, elle est rétablie. Le détail du traitement
          de vos données dans ce cadre figure dans la{" "}
          <Link href="/rgpd#signalements">politique de confidentialité</Link>.
        </p>
        <p>
          En sa qualité d&apos;hébergeur de ces contenus, l&apos;association conserve{" "}
          <strong>{CONNECTION_LOG_RETENTION_DAYS} jours</strong> les données de connexion de ses
          utilisateurs (adresse IP, date et heure, moyen de connexion), y compris après la suppression
          d&apos;un compte, afin de pouvoir identifier l&apos;auteur d&apos;un contenu sur
          réquisition d&apos;une autorité judiciaire (LCEN, art. 6 ; décret n° 2021-1362). Ces
          données ne sont communiquées qu&apos;aux autorités qui les requièrent ; le détail figure
          dans la <Link href="/rgpd#donnees-connexion">politique de confidentialité</Link>.
        </p>
      </>
    ),
  },
  {
    id: "autorites",
    title: "Point de contact des autorités",
    meta: "DSA ART. 11",
    body: (
      <>
        <p>
          Les autorités des États membres, la Commission européenne et le comité européen des
          services numériques joignent l&apos;association, en sa qualité d&apos;hébergeur des
          contenus de ses utilisateurs, par un <strong>point de contact unique</strong> : son courriel,{" "}
          <ProtectedContact encoded={ASSOCIATION_EMAIL_ENCODED} kind="email" owner="de l'association" />
          , ou le bouton <strong>« {REPORT_FORM_NAME} »</strong> en bas de chaque page, catégorie
          « Hébergeur ».
        </p>
        <p>Langues acceptées : {AUTHORITY_CONTACT_LANGUAGES.join(" et ")}.</p>
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
          Les informations recueillies lors de la création d&apos;un compte et de l&apos;utilisation
          du site sont traitées par l&apos;association Bluegenji Esport, responsable du traitement,
          pour gérer votre participation à ses activités. Elles ne sont pas réservées à
          l&apos;association : ce que le site publie se lit des autres joueurs et du public, et
          certaines données sont communiquées à des services tiers — Discord, Google, Blizzard, le
          service de push de votre navigateur, Microsoft pour les sauvegardes chiffrées et, sans chiffrement propre à l&apos;association,
          pour la messagerie de la personne à contacter pour vos demandes, et son opérateur
          téléphonique si vous l&apos;appelez ou lui laissez un SMS ou un message vocal —, dans les
          limites décrites à la section{" "}
          <Link href="/rgpd#destinataires">« Destinataires et transferts »</Link> de la politique de
          confidentialité et, traitement par traitement, dans son registre.
        </p>
        <p>
          Conformément au Règlement Général sur la Protection des Données (RGPD — Règlement UE
          2016/679), vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement,
          de limitation et de portabilité des données vous concernant, ainsi que d&apos;un droit
          d&apos;opposition au traitement, et vous pouvez définir des directives relatives à leur
          sort après votre décès (art. 85 de la loi Informatique et Libertés).
        </p>
        <p>
          <strong>Personne à contacter pour vos demandes relatives à vos données :</strong>{" "}
          {DATA_CONTACT_NAME}, {DATA_CONTACT_ROLE} — courriel :{" "}
          <ProtectedContact encoded={DATA_CONTACT_EMAIL_ENCODED} kind="email" owner={`de ${DATA_CONTACT_NAME}`} />
          , téléphone :{" "}
          <ProtectedContact encoded={DATA_CONTACT_PHONE_ENCODED} kind="phone" owner={`de ${DATA_CONTACT_NAME}`} />
          . Vos droits peuvent aussi être exercés par le bouton « {REPORT_FORM_NAME} » en bas de
          chaque page, catégorie « RGPD », ou auprès de l&apos;association, par les coordonnées
          données plus haut. Cette personne n&apos;est pas un délégué à la protection des données
          au sens de l&apos;article 37 du RGPD : l&apos;association reste responsable du
          traitement. Le détail des traitements, leurs durées et leur registre figurent dans la{" "}
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
          utilisateur connecté, l&apos;état d&apos;une connexion en cours, vos réglages
          d&apos;accessibilité et le souvenir des annonces de recrutement déjà vues. Aucun ne permet
          de suivi publicitaire. Leur liste complète, avec celle des autres données que le site
          garde dans votre navigateur (stockage local, stockage de session, cache de la page
          hors ligne) et leur durée, figure dans la{" "}
          <Link href="/rgpd#cookies">politique de confidentialité</Link>.
        </p>
        <p>
          Aucun traceur publicitaire, outil de mesure d&apos;audience externe ni cookie tiers
          n&apos;est utilisé. La fréquentation du site est mesurée par le site lui-même, sans
          cookie : voir la <Link href="/rgpd#audience">mesure d&apos;audience</Link>. La
          communication entre votre navigateur et le serveur est chiffrée (HTTPS).
        </p>
      </>
    ),
  },
];
