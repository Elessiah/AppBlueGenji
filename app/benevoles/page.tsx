import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { can } from "@/lib/shared/permissions";
import { listBenevoles } from "@/lib/server/benevoles-service";
import { BenevolesSection } from "./BenevolesSection";
import styles from "./page.module.css";

/**
 * Page traduite (`/en/benevoles`, lot 5b — `docs/features/I18N.md`
 * § Association, bénévoles, recrutement) : métadonnées, canonique et
 * `hreflang` dans la langue, carte d'aperçu anglaise.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).volunteers;
  return pageMetadata({
    title: meta.title,
    description: meta.description,
    shareDescription: meta.shareDescription,
    path: "/benevoles",
    shareCard: "volunteers",
    locale,
  });
}

export default async function BenevolesPage() {
  const [user, benevoles, locale] = await Promise.all([getCurrentUser(), listBenevoles(), requestLocale()]);
  const messages = messagesFor(locale).volunteers;
  // Gestion des bénévoles : administrateurs + Community Managers.
  const isAdmin = can(user, "showcase");

  return (
    <PublicPageShell>
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">{messages.hero.eyebrow}</span>
        <h1 className={`display ${styles.heroTitle}`}>
          {messages.hero.titleLead}
          <br />
          <span className="text-gradient">{messages.hero.titleAccent}</span>
        </h1>
        <p className={styles.heroSub}>{messages.hero.sub}</p>
      </section>

      {/* Les textes visiteurs de la section voyagent avec elle (cinq phrases) :
          sous `/en`, sous leur forme anglaise. */}
      <BenevolesSection initialBenevoles={benevoles} isAdmin={isAdmin} locale={locale} messages={messages.section} />
    </PublicPageShell>
  );
}
