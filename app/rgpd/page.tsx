import type { Metadata } from "next";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import {
  DONNEES_PROFIL,
  DONNEE_TOURNOIS,
  DROITS,
  RGPD_CONTACT_EMAIL,
} from "@/lib/shared/rgpd-policy";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "BlueGenji — Politique de confidentialité (RGPD)",
  description:
    "Politique de confidentialité de BlueGenji : données collectées, droits des utilisateurs, durées de conservation et contact RGPD.",
};

export default function RgpdPage() {
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
          de la plateforme. Aucune revente de données, aucun traceur tiers, aucune
          publicité ciblée.
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
            <strong>BlueGenji</strong> — association loi 1901, siège social à Lyon.<br />
            SIRET 912 345 678 00017 · RNA W691234567
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
            {DONNEES_PROFIL.map((d) => (
              <tr key={d.donnee}>
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
          </tbody>
        </table>
        <p style={{ marginTop: 16, fontSize: 13, color: "var(--ink-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}>
          * Les données de profil sont supprimées dans les 30 jours suivant la clôture du compte.
          Les sessions (cookie <code>bg_session</code>) expirent au bout de 30 jours d'inactivité.
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
          («&nbsp;Joueur supprimé&nbsp;») dans les archives.
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
            <li key={droit.title} className={styles.rightItem}>
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
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 05</span>
            <h2 className={styles.sectionTitle}>Cookies & traceurs</h2>
          </div>
          <span className={styles.meta}>AUCUN TIERS</span>
        </header>
        <div className={styles.prose}>
          <p>
            BlueGenji n'utilise <strong>aucun cookie publicitaire, aucun traceur
            analytique tiers</strong> (Google Analytics, Meta Pixel, etc.), aucun
            service de fingerprinting.
          </p>
          <p>
            Un seul cookie technique est déposé lors de la connexion :
          </p>
          <ul>
            <li>
              <strong>bg_session</strong> — cookie de session httpOnly, sameSite=lax,
              durée 30 jours. Il contient uniquement un jeton opaque haché (SHA-256)
              permettant de vous identifier sur la plateforme. Il est supprimé à la
              déconnexion.
            </li>
          </ul>
          <p>
            Aucun bandeau de consentement cookies n'est requis pour ce cookie strictement
            nécessaire au fonctionnement du service (directive ePrivacy, art. 5.3, exemption
            cookies fonctionnels).
          </p>
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
          <span className={styles.contactValue}>{RGPD_CONTACT_EMAIL}</span>
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
          Dernière mise à jour : juin 2026 · Applicable depuis la création de la plateforme
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
