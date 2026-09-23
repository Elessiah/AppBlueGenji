import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { CyberButton } from "@/components/cyber";
import { RGPD_CONTACT_EMAIL_FALLBACK } from "@/lib/shared/rgpd-policy";
import {
  PROCESSING_ACTIVITIES,
  REGISTER_UPDATED_AT,
  registerController,
  type ProcessingActivity,
} from "@/lib/shared/processing-register";
import styles from "../page.module.css";

export const metadata: Metadata = pageMetadata({
  title: "Registre des traitements",
  description:
    "Registre des activités de traitement de BlueGenji (RGPD, article 30) : finalités, données, durées de conservation, destinataires et mesures de sécurité.",
  path: "/rgpd/registre",
});

/** `2026-09-23` → `23/09/2026` : une date de document, pas un instant. */
function frenchDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function Field({ label, items }: { label: string; items: readonly string[] | string }) {
  const list = typeof items === "string" ? [items] : items;
  return (
    <tr>
      <th scope="row" className={styles.registerLabel}>
        {label}
      </th>
      <td>
        {list.length === 1 ? (
          list[0]
        ) : (
          <ul className={styles.registerList}>
            {list.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function ActivityCard({ activity }: { activity: ProcessingActivity }) {
  return (
    <article className={styles.registerCard} id={activity.ref.toLowerCase()} aria-labelledby={`${activity.ref}-title`}>
      <h3 className={styles.registerTitle} id={`${activity.ref}-title`}>
        <span className={styles.rightNum}>{activity.ref}</span> {activity.name}
      </h3>
      <table className={styles.registerTable}>
        <tbody>
          <Field label="Finalité principale" items={activity.purpose} />
          <Field label="Sous-finalités" items={activity.subPurposes} />
          <Field label="Base légale" items={activity.legalBasis} />
          <Field label="Personnes concernées" items={activity.dataSubjects} />
          <Field label="Données" items={activity.dataCategories} />
          <Field label="Données sensibles" items={activity.sensitiveData} />
          <Field label="Conservation" items={activity.retention} />
          <Field label="Destinataires" items={activity.recipients} />
          <Field label="Transferts hors UE" items={activity.transfers} />
          <Field label="Sécurité" items={activity.security} />
        </tbody>
      </table>
    </article>
  );
}

export default function RegistrePage() {
  const controller = registerController(process.env.RGPD_CONTACT_EMAIL ?? RGPD_CONTACT_EMAIL_FALLBACK);
  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />

      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">RGPD · ARTICLE 30</span>
        <h1 className="display" style={{ marginTop: 16, maxWidth: 640 }}>
          Registre des<br />traitements
        </h1>
        <p style={{ marginTop: 20, fontSize: 15, color: "var(--ink-mute)", lineHeight: 1.7, maxWidth: 580 }}>
          La liste de tout ce que BlueGenji fait de données personnelles, rubrique par rubrique
          selon le modèle de la CNIL. Elle est publique : chacun peut la consulter ou la
          télécharger, sans compte et sans demande.
        </p>
        <div className={styles.registerActions}>
          <CyberButton asChild variant="primary">
            <a href="/rgpd/registre.csv" download>
              Télécharger le registre (tableur CSV)
            </a>
          </CyberButton>
          <Link className={styles.registerBack} href="/rgpd">
            ← Politique de confidentialité
          </Link>
        </div>
      </section>

      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">RESPONSABLE</span>
            <h2 className={styles.sectionTitle}>Acteurs</h2>
          </div>
          <span className={styles.meta}>MIS À JOUR LE {frenchDate(REGISTER_UPDATED_AT)}</span>
        </header>
        <table className={styles.registerTable}>
          <tbody>
            <Field label="Responsable du traitement" items={`${controller.name} — ${controller.legalForm}, ${controller.seat}`} />
            <Field label="Contact" items={controller.contactEmail} />
            <Field label="Délégué à la protection des données" items={controller.dpo} />
          </tbody>
        </table>
      </section>

      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">{PROCESSING_ACTIVITIES.length} TRAITEMENTS</span>
            <h2 className={styles.sectionTitle}>Activités de traitement</h2>
          </div>
        </header>
        <nav aria-label="Traitements" className={styles.registerToc}>
          {PROCESSING_ACTIVITIES.map((a) => (
            <a key={a.ref} href={`#${a.ref.toLowerCase()}`}>
              <span className={styles.rightNum}>{a.ref}</span> {a.name}
            </a>
          ))}
        </nav>
        <div className={styles.registerCards}>
          {PROCESSING_ACTIVITIES.map((a) => (
            <ActivityCard key={a.ref} activity={a} />
          ))}
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
