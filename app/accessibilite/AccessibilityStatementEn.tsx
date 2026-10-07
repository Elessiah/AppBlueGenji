import { EnglishLegalLink } from "@/components/legal/EnglishLegalLink";
import { TranslationNotice } from "@/components/legal/TranslationNotice";
import { ProtectedContact } from "@/components/ui/protected-contact";
import { messagesFor } from "@/lib/server/i18n-messages";
import { A11Y_SETTINGS } from "@/lib/shared/accessibility-settings";
import { AUDIT_CONFORMITY_RATE, CONFORMITY_STATUS, TECHNOLOGIES } from "@/lib/shared/accessibility-statement";
import {
  ACCESSIBILITY_STANDARD_EN,
  CONFORMITY_LABELS_EN,
  EVALUATION_ENVIRONMENT_EN,
  EVALUATION_METHODS_EN,
  EVALUATION_SAMPLE_EN,
  KNOWN_ISSUES_EN,
  accessibilityStatementDateLabelEn,
} from "@/lib/shared/accessibility-statement-en";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { LEGAL_CONTACT_DISCORD } from "@/lib/shared/legal-contact";
import { REPORT_FORM_NAME_EN } from "@/lib/shared/legal-text-en";
import { ASSOCIATION_EMAIL_ENCODED } from "@/lib/shared/obfuscated-contact";
import styles from "./page.module.css";

/** How to reach us, repeated wherever a request is offered (the email is revealed on click). */
function ContactList() {
  return (
    <ul>
      <li>
        By email: <ProtectedContact encoded={ASSOCIATION_EMAIL_ENCODED} kind="email" owner="of the association" />
      </li>
      <li>
        Through the “{REPORT_FORM_NAME_EN}” form, at the bottom of every page (“Other” category,{" "}
        <span lang="fr">« Autre »</span>)
      </li>
      <li>
        On Discord, by direct message: <strong>{LEGAL_CONTACT_DISCORD}</strong>
      </li>
      <li>
        On the{" "}
        <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
          association&apos;s Discord server (new tab)
        </a>
      </li>
    </ul>
  );
}

/**
 * The accessibility statement in English (lot 7b, D1): a translation of the
 * French page, which prevails. Status, rate and date come from the French
 * module (`accessibility-statement.ts`); the accessibility menu's settings are
 * listed with the shell's English wording (`shell.a11yMenu.settings`), the
 * one the menu itself shows under `/en`.
 */
export function AccessibilityStatementEn() {
  const dateLabel = accessibilityStatementDateLabelEn();
  const statusLabel = CONFORMITY_LABELS_EN[CONFORMITY_STATUS];
  const { settings } = messagesFor("en").shell.a11yMenu;

  return (
    <>
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">ACCESSIBILITY · RGAA 4.1.2</span>
        <h1 className={`display ${styles.heroTitle}`}>
          <span className="text-gradient">Accessibility statement</span>
        </h1>
        <p className={styles.lede}>
          The BlueGenji Esport association wants everyone to be able to register, follow a tournament
          and report a score, however they browse. To our knowledge, the association is not subject to
          the accessibility obligation (Article 47 of French Law No. 2005-102 of February 11, 2005 —{" "}
          <span lang="fr">loi n° 2005-102 du 11 février 2005</span>): this statement is published
          voluntarily, and says what we know — including what is not right yet.
        </p>
        <TranslationNotice frenchHref="/accessibilite" />
        <dl className={styles.facts}>
          <div>
            <dt>Status</dt>
            <dd>{statusLabel}</dd>
          </div>
          <div>
            <dt>Standard</dt>
            <dd>{ACCESSIBILITY_STANDARD_EN}</dd>
          </div>
          <div>
            <dt>Drawn up on</dt>
            <dd>{dateLabel}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="etat">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 01</span>
          <h2 id="etat" className={styles.sectionTitle}>
            Compliance status
          </h2>
        </header>
        <div className={styles.prose}>
          <p>
            The <strong>BlueGenji Esport</strong> site is <strong>{statusLabel}</strong> with{" "}
            {ACCESSIBILITY_STANDARD_EN}, the French accessibility standard (
            <span lang="fr">référentiel général d&apos;amélioration de l&apos;accessibilité</span>).
          </p>
          <p>
            {AUDIT_CONFORMITY_RATE === null
              ? "No complete audit against the standard has been carried out yet: without one, the RGAA method classifies the site as “non-compliant”, whatever work has been done. The known limitations are listed below, each with what allows you to work around it today."
              : `An audit measured a compliance rate of ${AUDIT_CONFORMITY_RATE}% of the applicable criteria.`}
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="limites">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 02</span>
          <h2 id="limites" className={styles.sectionTitle}>
            Inaccessible content
          </h2>
        </header>
        <ul className={styles.issues}>
          {KNOWN_ISSUES_EN.map((issue) => (
            <li key={issue.title} className={styles.issue}>
              <h3 className={styles.issueTitle}>{issue.title}</h3>
              <p className={styles.criterion}>{issue.criterion}</p>
              <p>{issue.detail}</p>
              {issue.workaround ? (
                <div className={styles.workaround}>
                  <p>
                    <strong>In the meantime: </strong>
                    {issue.workaround}
                  </p>
                  {issue.requestByContact ? <ContactList /> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="aides">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 03</span>
          <h2 id="aides" className={styles.sectionTitle}>
            Help available on every page
          </h2>
        </header>
        <div className={styles.prose}>
          <p>
            The button on the left edge of every page (bottom left on a phone) opens the{" "}
            <strong>accessibility menu</strong>. Its settings are off by default and saved in your browser:
          </p>
          <ul>
            {A11Y_SETTINGS.map((setting) => (
              <li key={setting.key}>{`${settings[setting.key].label} — ${settings[setting.key].description}`}</li>
            ))}
          </ul>
          <p>
            Every page also opens with a “{messagesFor("en").shell.skipLink.label}” link, reachable with the
            keyboard from the first press of the Tab key.
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="evaluation">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 04</span>
          <h2 id="evaluation" className={styles.sectionTitle}>
            How this statement was drawn up
          </h2>
        </header>
        <div className={styles.prose}>
          <p>
            <strong>Technologies used:</strong> {TECHNOLOGIES.join(", ")}.
          </p>
          <p>
            <strong>Evaluation methods:</strong>
          </p>
          <ul>
            {EVALUATION_METHODS_EN.map((method) => (
              <li key={method}>{method}</li>
            ))}
          </ul>
          <p>
            <strong>Test environment:</strong> {EVALUATION_ENVIRONMENT_EN}
          </p>
          <p>
            <strong>Pages checked:</strong> {EVALUATION_SAMPLE_EN}
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="contact">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 05</span>
          <h2 id="contact" className={styles.sectionTitle}>
            Feedback and contact
          </h2>
        </header>
        <div className={styles.prose}>
          <p>
            If you cannot access content or a service, write to us: we will look for an accessible
            alternative, or send you the information in another form.
          </p>
          <ContactList />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="recours">
        <header className={styles.head}>
          <span className="eyebrow">SECTION 06</span>
          <h2 id="recours" className={styles.sectionTitle}>
            Means of redress
          </h2>
        </header>
        <div className={styles.prose}>
          <p>
            If you have reported to us a defect that prevents you from accessing content or a service and
            you have not received a satisfactory answer, you can refer the matter to the{" "}
            <span lang="fr">Défenseur des droits</span> (the French Defender of Rights):
          </p>
          <ul>
            <li>
              through the{" "}
              <a href="https://formulaire.defenseurdesdroits.fr/" target="_blank" rel="noreferrer" hrefLang="fr">
                Defender of Rights&apos; online form (in French, new tab)
              </a>
              {/* NOSONAR S6772 — ponctuation accolée au lien */}
              ;
            </li>
            <li>
              by contacting{" "}
              <a href="https://www.defenseurdesdroits.fr/carte-des-delegues" target="_blank" rel="noreferrer" hrefLang="fr">
                the delegate for your region (in French, new tab)
              </a>
              {/* NOSONAR S6772 — ponctuation accolée au lien */}
              ;
            </li>
            <li>
              by post, free of charge and without a stamp:{" "}
              <span lang="fr">Défenseur des droits, Libre réponse 71120, 75342 Paris CEDEX 07</span>.
            </li>
          </ul>
          <p>
            See also the <EnglishLegalLink href="/mentions-legales">legal notice</EnglishLegalLink> and the{" "}
            <EnglishLegalLink href="/rgpd">privacy policy</EnglishLegalLink>.
          </p>
        </div>
      </section>
    </>
  );
}
