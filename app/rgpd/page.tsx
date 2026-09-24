import type { Metadata } from "next";
import Link from "next/link";
import { CyberButton } from "@/components/cyber";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import {
  DONNEES_PROFIL,
  DONNEE_SAUVEGARDES,
  DONNEE_TOURNOIS,
  DROITS,
  RGPD_CONTACT_EMAIL_FALLBACK,
} from "@/lib/shared/rgpd-policy";
import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { privacyPolicyUpdatedLabel } from "@/lib/shared/privacy-changes";
import styles from "./page.module.css";

export const metadata: Metadata = pageMetadata({
  title: "Politique de confidentialité (RGPD)",
  description:
    "Politique de confidentialité de BlueGenji : données collectées, droits des utilisateurs, durées de conservation et contact RGPD.",
  path: "/rgpd",
});

export default function RgpdPage() {
  const contactEmail = process.env.RGPD_CONTACT_EMAIL ?? RGPD_CONTACT_EMAIL_FALLBACK;
  // La date suit le dernier changement présenté aux joueurs
  // (`lib/shared/privacy-changes.ts`) : écrite à la main, elle restait en juin
  // pendant que la politique changeait.
  const updatedLabel = privacyPolicyUpdatedLabel() ?? "septembre 2026";
  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />

      {/* HERO */}
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">PROTECTION DES DONNÉES · RGPD</span>
        <h1 className="display" style={{ marginTop: 16, maxWidth: 600 }}>
          Politique de<br />confidentialité
        </h1>
        <p style={{ marginTop: 20, fontSize: 15, color: "var(--ink-mute)", lineHeight: 1.7, maxWidth: 560 }}>
          BlueGenji ne collecte que les données strictement nécessaires au fonctionnement
          de la plateforme. Aucune revente de données, aucun traceur publicitaire ni
          analytique, aucune publicité ciblée.
        </p>
      </section>

      {/* SECTION 01 — RESPONSABLE */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 01</span>
            <h2 className={styles.sectionTitle}>Responsable du traitement</h2>
          </div>
          <span className={styles.meta}>QUI TRAITE VOS DONNÉES</span>
        </header>
        <div className={styles.prose}>
          <p>
            <strong>BlueGenji</strong> — association loi 1901, siège social à Janvilliers.
          </p>
          <p>
            Pour toute question relative à vos données personnelles, contactez-nous
            à l'adresse indiquée en section&nbsp;06.
          </p>
        </div>
      </section>

      {/* SECTION 02 — DONNÉES COLLECTÉES */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 02</span>
            <h2 className={styles.sectionTitle}>Données collectées</h2>
          </div>
          <span className={styles.meta}>CE QUE NOUS STOCKONS</span>
        </header>
        <div className={styles.prose}>
          <p>
            BlueGenji ne demande aucun nom réel, aucun numéro de téléphone, aucune
            adresse postale. L'ensemble des données repose sur des pseudonymes de jeu.
          </p>
        </div>
        <table className={styles.dataTable} style={{ marginTop: 24 }}>
          <thead>
            <tr>
              <th>Donnée</th>
              <th>Finalité</th>
              <th>Base légale</th>
              <th>Conservation</th>
            </tr>
          </thead>
          <tbody>
            {DONNEES_PROFIL.map((d, i) => (
              <tr key={i}>
                <td>{d.donnee}</td>
                <td>{d.finalite}</td>
                <td>
                  <span className={styles.badge}>{d.base}</span>
                </td>
                <td>{d.duree}</td>
              </tr>
            ))}
            <tr>
              <td>{DONNEE_TOURNOIS.donnee}</td>
              <td>{DONNEE_TOURNOIS.finalite}</td>
              <td>
                <span className={styles.badgeAmber}>{DONNEE_TOURNOIS.base}</span>
              </td>
              <td>{DONNEE_TOURNOIS.duree}</td>
            </tr>
            <tr>
              <td>{DONNEE_SAUVEGARDES.donnee}</td>
              <td>{DONNEE_SAUVEGARDES.finalite}</td>
              <td>
                <span className={styles.badgeAmber}>{DONNEE_SAUVEGARDES.base}</span>
              </td>
              <td>{DONNEE_SAUVEGARDES.duree} **</td>
            </tr>
          </tbody>
        </table>
        <p style={{ marginTop: 16, fontSize: 13, color: "var(--ink-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}>
          * Un compte qui n'a participé à aucun tournoi, n'en a organisé aucun et n'est
          propriétaire d'aucune équipe est <strong>entièrement effacé</strong> à sa suppression.
          Sinon, ses données de profil sont anonymisées immédiatement. Les sessions
          (cookie <code>bg_session</code>) expirent 30 jours après la connexion.
        </p>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}>
          ** Une donnée supprimée subsiste jusqu'à {BACKUP_RETENTION_DAYS} jours dans les copies
          de sauvegarde chiffrées, qu'on ne peut pas modifier une à une ; si l'une d'elles devait
          être restaurée, les suppressions intervenues depuis sont réappliquées avant la remise en
          service. Les images téléversées (avatar, logo) sont retirées de la sauvegarde dans
          l'heure.
        </p>
      </section>

      {/* SECTION 03 — HISTORIQUE & PALMARÈS */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 03</span>
            <h2 className={styles.sectionTitle}>Historique de tournois & palmarès</h2>
          </div>
          <span className={styles.meta}>CONFORMITÉ RGPD</span>
        </header>
        <div className={styles.prose}>
          <p>
            Les résultats de compétitions (scores, classements, brackets) constituent
            un <strong>palmarès sportif</strong>. À ce titre, leur conservation indéfinie
            est fondée sur l'<strong>intérêt légitime</strong> de l'association et la
            mémoire collective de la scène esport francophone.
          </p>
        </div>
        <div className={styles.highlight} style={{ marginTop: 20 }}>
          <strong>Ce que cela signifie concrètement :</strong> les statistiques
          (nombre de tournois joués, scores, placements) ne sont pas effacées lors de
          la suppression du compte. En revanche, les données de profil liées (pseudo,
          avatar) sont anonymisées — le palmarès subsiste sous une forme neutre
          («&nbsp;Joueur supprimé&nbsp;») dans les archives. Un compte qui n'a jamais été
          engagé dans un tournoi n'a, lui, aucun palmarès à préserver : il est effacé
          entièrement, sans ligne résiduelle — à deux réserves près, où sa ligne reste parce
          qu'elle est le titulaire de quelque chose qui survit : s'il a{" "}
          <strong>organisé</strong> un tournoi, ou s'il est{" "}
          <strong>propriétaire d'une équipe</strong> (transférer ou
          dissoudre l'équipe avant la suppression rétablit l'effacement complet).
        </div>
        <div className={styles.prose} style={{ marginTop: 20 }}>
          <p>
            Cette approche est conforme au RGPD sous trois conditions que nous respectons :
          </p>
          <ul>
            <li>
              <strong>Pseudonymisation :</strong> aucune donnée d'identité réelle n'est
              attachée aux résultats (les pseudos de jeu ne constituent pas une identité
              directement identifiable au sens strict).
            </li>
            <li>
              <strong>Information préalable :</strong> la présente politique informe les
              utilisateurs avant toute inscription.
            </li>
            <li>
              <strong>Droit d'opposition :</strong> vous pouvez vous opposer à cette
              conservation en nous contactant — nous examinerons chaque demande au cas
              par cas conformément à l'article 21 du RGPD.
            </li>
          </ul>
        </div>
      </section>

      {/* SECTION 04 — VOS DROITS */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 04</span>
            <h2 className={styles.sectionTitle}>Vos droits</h2>
          </div>
          <span className={styles.meta}>RGPD ART. 15–22</span>
        </header>
        <ul className={styles.rightsList}>
          {DROITS.map((droit, i) => (
            <li key={i} className={styles.rightItem}>
              <span className={styles.rightNum}>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className={styles.rightTitle}>{droit.title}</h3>
                <p className={styles.rightText}>{droit.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* SECTION 05 — COOKIES */}
      <section id="cookies" className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 05</span>
            <h2 className={styles.sectionTitle}>Cookies & traceurs</h2>
          </div>
          <span className={styles.meta}>GOOGLE SUR /CONNEXION SEULEMENT</span>
        </header>
        <div className={styles.prose}>
          <p>
            BlueGenji n'utilise <strong>aucun cookie publicitaire, aucun traceur
            analytique tiers</strong> (Google Analytics, Meta Pixel, etc.), aucun
            service de fingerprinting.
          </p>
          <p>
            Seuls des cookies techniques sont déposés :
          </p>
          <ul>
            <li>
              <strong>bg_session</strong> — cookie de session httpOnly, sameSite=lax,
              durée 30 jours, déposé <strong>à la connexion</strong>. Il contient
              uniquement un jeton opaque haché (SHA-256) permettant de vous identifier
              sur la plateforme. Il est supprimé à la déconnexion.
            </li>
            <li>
              <strong>bg_oauth</strong> — déposé <strong>le temps d&apos;une connexion</strong>{" "}
              par Google, Discord ou Blizzard, et supprimé dès le retour. Il dure dix minutes
              au plus et ne contient qu&apos;un jeton aléatoire à usage unique (protection
              anti-CSRF), le nom du fournisseur et la page où te ramener. Aucun identifiant de
              personne.
            </li>
            <li>
              <strong>bg_recr_modal</strong> et <strong>bg_recr_banner</strong> — déposés
              uniquement <strong>si vous fermez une annonce de recrutement</strong> mise en
              avant, pour ne pas vous la réafficher. Ils ne contiennent que le numéro de
              l'annonce concernée, jamais d'identifiant de personne : ils ne permettent ni de
              vous reconnaître, ni de vous suivre d'un site à l'autre (sameSite=strict). Le
              premier dure sept jours, le second le temps de votre visite.
            </li>
            <li>
              <strong>bg_match_focus</strong> et <strong>bg_power_ignore_perf</strong> — deux
              valeurs du stockage local de votre navigateur, <strong>jamais transmises</strong> au
              serveur. La première allège les autres onglets du site pendant votre match (un
              numéro d&apos;onglet tiré au hasard et une échéance de vingt minutes au plus) ; la
              seconde retient votre choix d&apos;ignorer la détection de performances du mode éco.
            </li>
            <li>
              <strong>bg:last-visit-ping</strong> — une valeur du stockage de session, effacée à la
              fermeture de l&apos;onglet : l&apos;heure du dernier signalement de visite, pour ne pas
              compter deux fois le même chargement. Elle n&apos;identifie personne.
            </li>
            <li>
              <strong>bg_rgpd_consent</strong> — une valeur du stockage local, posée sur la page de
              connexion <strong>quand vous acceptez</strong> cette politique, pour ne pas vous la
              redemander.
            </li>
          </ul>
          <p>
            Aucun bandeau de consentement cookies n&apos;est requis pour ces cookies strictement
            nécessaires au fonctionnement du service ou déposés à votre demande (directive
            ePrivacy, art. 5.3, exemption cookies fonctionnels).
          </p>
          <p>
            <strong>Une seule exception, et sur une seule page.</strong> Sur la page de connexion,
            et seulement <strong>après</strong> que vous avez accepté cette politique, le site
            charge l&apos;invite de connexion de Google (Google One Tap,{" "}
            <code>accounts.google.com</code>). Google reçoit alors votre adresse IP, lit sa propre
            session pour vous proposer de continuer avec votre compte Google, et peut déposer sur
            notre domaine un cookie <strong>g_state</strong> retenant que vous avez fermé
            l&apos;invite. Google agit comme responsable de son propre traitement. Aucune autre
            page du site ne fait appel à Google, et vous pouvez toujours vous connecter par
            Discord, Blizzard ou un code en message privé.
          </p>
        </div>
      </section>

      {/* REGISTRE — public, sans demande à faire */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">RGPD · ARTICLE 30</span>
            <h2 className={styles.sectionTitle}>Registre des traitements</h2>
          </div>
          <span className={styles.meta}>{PROCESSING_ACTIVITIES.length} TRAITEMENTS</span>
        </header>
        <div className={styles.prose}>
          <p>
            Le registre recense tout ce que BlueGenji fait de données personnelles :
            finalités, données, durées de conservation, destinataires, transferts et
            mesures de sécurité. Il est <strong>public</strong> — consultable et
            téléchargeable par tous, sans compte ni demande.
          </p>
        </div>
        <div className={styles.registerActions}>
          <CyberButton asChild variant="primary">
            <a href="/rgpd/registre.csv" download>
              Télécharger le registre (tableur CSV)
            </a>
          </CyberButton>
          <Link className={styles.registerBack} href="/rgpd/registre">
            Consulter en ligne →
          </Link>
        </div>
      </section>

      {/* SECTION 06 — CONTACT */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 06</span>
            <h2 className={styles.sectionTitle}>Exercer vos droits</h2>
          </div>
          <span className={styles.meta}>DÉLAI LÉGAL : 1 MOIS</span>
        </header>
        <div className={styles.prose}>
          <p>
            Pour exercer l'un de vos droits ou poser une question relative au
            traitement de vos données, contactez le responsable de traitement.
            Nous répondons dans un délai maximum d'<strong>un mois</strong> (art. 12 RGPD).
          </p>
        </div>
        <div className={styles.contactBlock} style={{ marginTop: 24 }}>
          <span className={styles.contactLabel}>Contact RGPD</span>
          <span className={styles.contactValue}>{contactEmail}</span>
          <span className={styles.contactSub}>Objet recommandé : « Demande RGPD — [droit concerné] »</span>
        </div>
        <div className={styles.prose} style={{ marginTop: 20 }}>
          <p>
            En cas de réponse insatisfaisante, vous disposez du droit d'introduire
            une réclamation auprès de la <strong>CNIL</strong> (Commission Nationale
            de l'Informatique et des Libertés) sur{" "}
            <a
              href="https://www.cnil.fr"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--blue-300)", textDecoration: "underline", textDecorationColor: "rgba(90,200,255,0.3)" }}
            >
              cnil.fr
            </a>
            .
          </p>
        </div>
        <div className={styles.updateLine}>
          Dernière mise à jour : {updatedLabel} · Applicable depuis la création de la plateforme
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
