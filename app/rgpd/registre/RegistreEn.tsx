import { Fragment, type ReactNode } from "react";
import { CyberButton } from "@/components/cyber";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { TranslationNotice } from "@/components/legal/TranslationNotice";
import { REGISTER_UPDATED_AT, type ProcessingActivity } from "@/lib/shared/processing-register";
import {
  PROCESSING_ACTIVITIES_EN,
  REGISTER_SCOPE_DETAIL_EN,
  REGISTER_SCOPE_EN,
  registerControllerEn,
} from "@/lib/shared/processing-register-en";
import { formatPrivacyChangeDateIn } from "@/lib/shared/privacy-changes";
import { ASSOCIATION_SEAT } from "@/lib/shared/legal-contact";
import { SITE_HOST } from "@/lib/shared/site-host";
import styles from "../page.module.css";

/** Postal addresses stay French (`lang="fr"`) inside an English sentence (WCAG 3.1.2). */
const FRENCH_ADDRESSES = [ASSOCIATION_SEAT, SITE_HOST.address];

function withFrenchAddresses(text: string): ReactNode {
  const address = FRENCH_ADDRESSES.find((candidate) => text.includes(candidate));
  if (!address) return text;
  const [before, ...rest] = text.split(address);
  return (
    <>
      {before}
      <span lang="fr">{address}</span>
      {withFrenchAddresses(rest.join(address))}
    </>
  );
}

function Field({ label, items }: Readonly<{ label: string; items: readonly string[] | string }>) {
  const list = typeof items === "string" ? [items] : items;
  return (
    <tr>
      <th scope="row" className={styles.registerLabel}>
        {label}
      </th>
      <td>
        {list.length === 1 ? (
          <Fragment>{withFrenchAddresses(list[0])}</Fragment>
        ) : (
          <ul className={styles.registerList}>
            {list.map((item) => (
              <li key={item}>{withFrenchAddresses(item)}</li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function ActivityCard({ activity }: Readonly<{ activity: ProcessingActivity }>) {
  return (
    <article className={styles.registerCard} id={activity.ref.toLowerCase()} aria-labelledby={`${activity.ref}-title`}>
      <h3 className={styles.registerTitle} id={`${activity.ref}-title`}>
        <span className={styles.rightNum}>{activity.ref}</span> {activity.name}
      </h3>
      <table className={styles.registerTable}>
        <tbody>
          <Field label="Main purpose" items={activity.purpose} />
          <Field label="Sub-purposes" items={activity.subPurposes} />
          <Field label="Legal basis" items={activity.legalBasis} />
          <Field label="Data subjects" items={activity.dataSubjects} />
          <Field label="Data" items={activity.dataCategories} />
          <Field label="Sensitive data" items={activity.sensitiveData} />
          <Field label="Retention" items={activity.retention} />
          <Field label="Recipients" items={activity.recipients} />
          <Field label="Transfers outside the EU" items={activity.transfers} />
          <Field label="Security" items={activity.security} />
        </tbody>
      </table>
    </article>
  );
}

/**
 * The record of processing activities in English (lot 7b-2, D1): a
 * translation of the French register, which prevails. Same activities,
 * references and anchors (`#t01`…); the update date is the French register's.
 * The CSV export stays French, the document handed to the CNIL — the button
 * says so.
 */
export function RegistreEn() {
  const controller = registerControllerEn();
  return (
    <>
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">GDPR · ARTICLE 30</span>
        <h1 className="display" style={{ marginTop: 16, maxWidth: 640 }}>
          Record of<br /><span className="text-gradient">processing activities</span>
        </h1>
        <p style={{ marginTop: 20, fontSize: 15, color: "var(--ink-mute)", lineHeight: 1.7, maxWidth: 580 }}>
          {REGISTER_SCOPE_EN}, heading by heading following the CNIL&apos;s model (the French data protection
          authority). It is public: anyone can consult or download it, without an account and without asking.
        </p>
        <p style={{ marginTop: 12, fontSize: 14, color: "var(--ink-mute)", lineHeight: 1.7, maxWidth: 580 }}>
          {REGISTER_SCOPE_DETAIL_EN}
        </p>
        <TranslationNotice frenchHref="/rgpd/registre" />
        <div className={styles.registerActions}>
          <CyberButton asChild variant="primary">
            <a href="/rgpd/registre.csv" download hrefLang="fr">
              Download the register (CSV spreadsheet, in French)
            </a>
          </CyberButton>
          <LocaleLink className={styles.registerBack} href="/rgpd">
            ← Privacy policy
          </LocaleLink>
        </div>
      </section>

      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">CONTROLLER</span>
            <h2 className={styles.sectionTitle}>Parties</h2>
          </div>
          <span className={styles.meta}>UPDATED {formatPrivacyChangeDateIn(REGISTER_UPDATED_AT, "en").toUpperCase()}</span>
        </header>
        <table className={styles.registerTable}>
          <tbody>
            <Field label="Data controller" items={`${controller.name} — ${controller.legalForm}, ${controller.seat}`} />
            <Field label="Contact" items={controller.contact} />
            <Field label="Person to contact for requests regarding data" items={controller.dataContact} />
            <Field label="Host (processor)" items={controller.host} />
          </tbody>
        </table>
      </section>

      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">{PROCESSING_ACTIVITIES_EN.length} PROCESSING ACTIVITIES</span>
            <h2 className={styles.sectionTitle}>Processing activities</h2>
          </div>
        </header>
        <nav aria-label="Processing activities" className={styles.registerToc}>
          {PROCESSING_ACTIVITIES_EN.map((a) => (
            <a key={a.ref} href={`#${a.ref.toLowerCase()}`}>
              <span className={styles.rightNum}>{a.ref}</span> {a.name}
            </a>
          ))}
        </nav>
        <div className={styles.registerCards}>
          {PROCESSING_ACTIVITIES_EN.map((a) => (
            <ActivityCard key={a.ref} activity={a} />
          ))}
        </div>
      </section>
    </>
  );
}
