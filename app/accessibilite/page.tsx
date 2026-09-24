import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { RGPD_CONTACT_EMAIL_FALLBACK } from "@/lib/shared/rgpd-policy";
import {
  ACCESSIBILITY_STANDARD,
  AUDIT_CONFORMITY_RATE,
  CONFORMITY_LABELS,
  CONFORMITY_STATUS,
  EVALUATION_METHODS,
  KNOWN_ISSUES,
  TECHNOLOGIES,
  accessibilityFeatures,
  accessibilityStatementDateLabel,
} from "@/lib/shared/accessibility-statement";
import styles from "./page.module.css";

export const metadata: Metadata = pageMetadata({
  title: "Déclaration d'accessibilité",
  description:
    "État de conformité du site BlueGenji Esport au RGAA, contenus non accessibles, aides proposées et contact.",
  path: "/accessibilite",
});

/**
 * Déclaration d'accessibilité, au modèle RGAA 4.1. Le contenu vit dans
 * `lib/shared/accessibility-statement.ts` : la page ne décide de rien, elle met
 * en forme — le statut se déduit d'un taux d'audit, la liste des limites se
 * tient là-bas.
 */
export default function AccessibilityStatementPage() {
  const contactEmail = process.env.RGPD_CONTACT_EMAIL ?? RGPD_CONTACT_EMAIL_FALLBACK;
  const dateLabel = accessibilityStatementDateLabel();
  const statusLabel = CONFORMITY_LABELS[CONFORMITY_STATUS];

  return (
    <PublicPageShell>
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">ACCESSIBILITÉ · RGAA 4.1</span>
        <h1 className={`display ${styles.heroTitle}`}>Déclaration d&apos;accessibilité</h1>
        <p className={styles.lede}>
          L&apos;association BlueGenji Esport veut que chacun puisse s&apos;inscrire, suivre un
          tournoi et reporter un score, quelle que soit sa façon de naviguer. À notre connaissance,
          l&apos;association n&apos;est pas soumise à l&apos;obligation d&apos;accessibilité
          (article 47 de la loi n° 2005-102 du 11 février 2005) : cette déclaration est publiée
          volontairement, et dit ce que nous savons — y compris ce qui ne va pas encore.
        </p>
        <dl className={styles.facts}>
          <div>
            <dt>État</dt>
            <dd>{statusLabel}</dd>
          </div>
          <div>
            <dt>Référentiel</dt>
            <dd>{ACCESSIBILITY_STANDARD}</dd>
          </div>
          <div>
            <dt>Établie le</dt>
            <dd>{dateLabel}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="etat">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 01</span>
          <h2 id="etat" className={styles.sectionTitle}>
            État de conformité
          </h2>
        </header>
        <div className={styles.prose}>
          <p>
            Le site <strong>BlueGenji Esport</strong> est <strong>{statusLabel}</strong> avec le{" "}
            {ACCESSIBILITY_STANDARD}.
          </p>
          <p>
            {AUDIT_CONFORMITY_RATE === null
              ? "Aucun audit complet du référentiel n'a encore été mené : sans lui, la méthode RGAA classe le site « non conforme », quel que soit le travail accompli. Les limites connues sont listées ci-dessous, chacune avec ce qui permet de la contourner aujourd'hui."
              : `Un audit a mesuré un taux de conformité de ${AUDIT_CONFORMITY_RATE} % des critères applicables.`}
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="limites">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 02</span>
          <h2 id="limites" className={styles.sectionTitle}>
            Contenus non accessibles
          </h2>
        </header>
        <ul className={styles.issues}>
          {KNOWN_ISSUES.map((issue) => (
            <li key={issue.title} className={styles.issue}>
              <h3 className={styles.issueTitle}>{issue.title}</h3>
              <p className={styles.criterion}>{issue.criterion}</p>
              <p>{issue.detail}</p>
              {issue.workaround ? (
                <p className={styles.workaround}>
                  <strong>En attendant : </strong>
                  {issue.workaround}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="aides">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 03</span>
          <h2 id="aides" className={styles.sectionTitle}>
            Aides proposées sur chaque page
          </h2>
        </header>
        <div className={styles.prose}>
          <p>
            Le bouton en bas à gauche de chaque page ouvre le <strong>menu d&apos;accessibilité</strong>.
            Ses réglages sont désactivés par défaut et gardés dans ton navigateur :
          </p>
          <ul>
            {accessibilityFeatures().map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <p>
            Chaque page s&apos;ouvre aussi sur un lien « Aller au contenu », accessible au clavier
            dès la première tabulation.
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="evaluation">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 04</span>
          <h2 id="evaluation" className={styles.sectionTitle}>
            Établissement de cette déclaration
          </h2>
        </header>
        <div className={styles.prose}>
          <p>
            <strong>Technologies utilisées :</strong> {TECHNOLOGIES.join(", ")}.
          </p>
          <p>
            <strong>Méthodes d&apos;évaluation :</strong>
          </p>
          <ul>
            {EVALUATION_METHODS.map((method) => (
              <li key={method}>{method}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="contact">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 05</span>
          <h2 id="contact" className={styles.sectionTitle}>
            Retour d&apos;information et contact
          </h2>
        </header>
        <div className={styles.prose}>
          <p>
            Si tu n&apos;arrives pas à accéder à un contenu ou à un service, écris-nous : nous
            chercherons une alternative accessible, ou te transmettrons l&apos;information sous une
            autre forme.
          </p>
          <ul>
            <li>
              Par courriel : <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </li>
            <li>
              Sur le{" "}
              <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
                serveur Discord de l&apos;association (nouvel onglet)
              </a>
            </li>
          </ul>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="recours">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 06</span>
          <h2 id="recours" className={styles.sectionTitle}>
            Voies de recours
          </h2>
        </header>
        <div className={styles.prose}>
          <p>
            Si tu nous as signalé un défaut qui t&apos;empêche d&apos;accéder à un contenu ou à un
            service et que tu n&apos;as pas obtenu de réponse satisfaisante, tu peux saisir le
            Défenseur des droits :
          </p>
          <ul>
            <li>
              par le{" "}
              <a href="https://formulaire.defenseurdesdroits.fr/" target="_blank" rel="noreferrer">
                formulaire en ligne du Défenseur des droits (nouvel onglet)
              </a>
              ;
            </li>
            <li>
              en contactant{" "}
              <a href="https://www.defenseurdesdroits.fr/carte-des-delegues" target="_blank" rel="noreferrer">
                le délégué de ta région (nouvel onglet)
              </a>
              ;
            </li>
            <li>
              par courrier, gratuitement et sans timbre : Défenseur des droits, Libre réponse 71120,
              75342 Paris CEDEX 07.
            </li>
          </ul>
          <p>
            Voir aussi les <Link href="/mentions-legales">mentions légales</Link> et la{" "}
            <Link href="/rgpd">politique de confidentialité</Link>.
          </p>
        </div>
      </section>
    </PublicPageShell>
  );
}
