import { EnglishLegalLink } from "@/components/legal/EnglishLegalLink";
import { TranslationNotice } from "@/components/legal/TranslationNotice";
import { EmphasisText } from "@/components/rules/EmphasisText";
import { TERMS_PATH, TERMS_UPDATED_AT, TERMS_VERSION, formatTermsDateIn } from "@/lib/shared/terms-of-use";
import { TERMS_SECTIONS_EN } from "@/lib/shared/terms-of-use-en";
import styles from "./page.module.css";

/**
 * The terms of use in English (lot 7b, D1): a translation of the French text,
 * which alone is accepted and prevails — the notice says so and links to it.
 * Same version, same date, same articles and anchors as the French page.
 */
export function TermsOfUseEn() {
  return (
    <>
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">LEGAL · TERMS AND CONDITIONS</span>
        <h1 className={`display ${styles.heroTitle}`}>
          <span className="text-gradient">Terms of use</span>
        </h1>
        <p className={styles.heroLead}>
          What everyone agrees to respect when using the site, creating a team on it and publishing a
          logo or an avatar there. The processing of personal data is described in the{" "}
          <EnglishLegalLink href="/rgpd">privacy policy</EnglishLegalLink>. The tournament rules, which
          these terms supplement, are published on the{" "}
          <EnglishLegalLink href="/regles">Tournament rules</EnglishLegalLink> page.
        </p>
        <TranslationNotice frenchHref={TERMS_PATH} />
        <p className={styles.version}>
          <span>VERSION {TERMS_VERSION}</span>
          <time dateTime={TERMS_UPDATED_AT}>IN FORCE SINCE {formatTermsDateIn("en").toUpperCase()}</time>
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.layout}>
          <nav className={styles.toc} aria-label="Table of contents of the terms">
            <p className={styles.tocTitle}>CONTENTS</p>
            <ol>
              {TERMS_SECTIONS_EN.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    {index + 1}. {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className={styles.article}>
            {TERMS_SECTIONS_EN.map((section, index) => (
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
                    <EnglishLegalLink href={link.href}>{link.label}</EnglishLegalLink>
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
