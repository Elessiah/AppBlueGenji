import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { EmphasisText } from "@/components/rules/EmphasisText";
import { pageMetadata } from "@/lib/shared/page-metadata";
import {
  TERMS_PATH,
  TERMS_SECTIONS,
  TERMS_UPDATED_AT,
  TERMS_VERSION,
  formatTermsDate,
} from "@/lib/shared/terms-of-use";
import styles from "./page.module.css";

export const metadata: Metadata = pageMetadata({
  title: "Conditions d'utilisation",
  description:
    "Conditions générales d'utilisation de la plateforme BlueGenji Esport : compte, comportement, contenus publiés par les membres, signalement et modération.",
  shareDescription: "Ce que chacun s'engage à respecter sur BlueGenji Esport.",
  path: TERMS_PATH,
});

/**
 * Conditions générales d'utilisation, rendues depuis leur registre
 * (`lib/shared/terms-of-use.ts`) : la page ne peut pas afficher un texte
 * différent de la version que les comptes acceptent.
 */
export default function TermsOfUsePage() {
  return (
    <PublicPageShell>
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">LÉGAL · CONDITIONS GÉNÉRALES</span>
        <h1 className={`display ${styles.heroTitle}`}>Conditions d&apos;utilisation</h1>
        <p className={styles.heroLead}>
          Ce que chacun s&apos;engage à respecter en utilisant le site, en y créant une équipe et en y
          publiant un logo ou un avatar. Le traitement des données personnelles est décrit dans la{" "}
          <Link href="/rgpd">politique de confidentialité</Link>.
        </p>
        <p className={styles.version}>
          <span>VERSION {TERMS_VERSION}</span>
          <time dateTime={TERMS_UPDATED_AT}>EN VIGUEUR DEPUIS LE {formatTermsDate().toUpperCase()}</time>
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.layout}>
          <nav className={styles.toc} aria-label="Sommaire des conditions">
            <p className={styles.tocTitle}>SOMMAIRE</p>
            <ol>
              {TERMS_SECTIONS.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    {index + 1}. {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className={styles.article}>
            {TERMS_SECTIONS.map((section, index) => (
              <section key={section.id} id={section.id} className={styles.clause} aria-labelledby={`${section.id}-title`}>
                <span className={styles.clauseNumber}>ARTICLE {String(index + 1).padStart(2, "0")}</span>
                <h2 id={`${section.id}-title`} className={styles.clauseTitle}>
                  {section.title}
                </h2>
                {section.paragraphs.map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex}>
                    <EmphasisText text={paragraph} />
                  </p>
                ))}
              </section>
            ))}
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
