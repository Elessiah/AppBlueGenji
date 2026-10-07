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
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { TermsOfUseEn } from "./TermsOfUseEn";
import styles from "./page.module.css";

/**
 * Une langue par adresse (lot 7b) : `/conditions-utilisation` en français, le
 * texte qui fait foi et que les comptes acceptent ; `/en/…` sa traduction.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const meta = messagesFor(locale).legal.pages.terms;
  return pageMetadata({
    title: meta.title,
    description: meta.description,
    shareDescription: meta.shareDescription,
    path: TERMS_PATH,
    shareCard: "terms",
    locale,
  });
}

/**
 * Conditions générales d'utilisation, rendues depuis leur registre
 * (`lib/shared/terms-of-use.ts`) : la page ne peut pas afficher un texte
 * différent de la version que les comptes acceptent.
 */
export default async function TermsOfUsePage() {
  const locale = await requestLocale();
  return <PublicPageShell>{locale === "en" ? <TermsOfUseEn /> : <TermsOfUseFr />}</PublicPageShell>;
}

/**
 * Le texte français, tel qu'il est accepté (`TERMS_VERSION`) : le lot 7b n'y a
 * rien changé, à l'octet près (`tests/app/site-legal-i18n.test.tsx`).
 */
function TermsOfUseFr() {
  return (
    <>
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">LÉGAL · CONDITIONS GÉNÉRALES</span>
        <h1 className={`display ${styles.heroTitle}`}>
          <span className="text-gradient">Conditions d&apos;utilisation</span>
        </h1>
        <p className={styles.heroLead}>
          Ce que chacun s&apos;engage à respecter en utilisant le site, en y créant une équipe et en y
          publiant un logo ou un avatar. Le traitement des données personnelles est décrit dans la{" "}
          <Link href="/rgpd">politique de confidentialité</Link>. Les règles des tournois, que ces
          conditions complètent, sont publiées sur la page{" "}
          <Link href="/regles">Règles des tournois</Link>.
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
                  <p key={paragraphIndex} /* NOSONAR S6479 — paragraphes d'un texte constant, jamais réordonnés */>
                    <EmphasisText text={paragraph} />
                  </p>
                ))}
                {section.links?.map((link) => (
                  <p key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </p>
                ))}
              </section>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
