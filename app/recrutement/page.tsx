import type { Metadata } from "next";
import { pageMetadata } from "@/lib/shared/page-metadata";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { RecruitmentTextProvider } from "@/components/i18n/recruitment-text";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { can } from "@/lib/shared/permissions";
import { getRecruiterContactDefaults, listRecruitmentAds } from "@/lib/server/recruitment-service";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";
import { publicRecruitmentAds, type RecruiterContactDefaults } from "@/lib/shared/recruitment";
import { recruitmentClientMessages } from "@/lib/shared/recruitment-text";
import { RecruitmentSection } from "./RecruitmentSection";
import styles from "./page.module.css";

/**
 * Page traduite (`/en/recrutement`, lot 5b — `docs/features/I18N.md`
 * § Association, bénévoles, recrutement) : métadonnées, canonique et
 * `hreflang` dans la langue, carte d'aperçu anglaise.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const { meta } = messagesFor(locale).recruitment;
  return pageMetadata({
    title: meta.title,
    description: meta.description,
    shareDescription: meta.shareDescription,
    path: "/recrutement",
    shareCard: "recruitment",
    locale,
  });
}

export default async function RecrutementPage() {
  const [user, locale] = await Promise.all([getCurrentUser().catch(() => null), requestLocale()]);
  const messages = messagesFor(locale).recruitment;
  // Gestion du recrutement : administrateurs + Recruteurs.
  const isAdmin = can(user, "recruitment");
  // Les gestionnaires du recrutement voient aussi les brouillons (annonces inactives).
  // Leur liste garde le français **et** l'anglais : la section montre la langue
  // de la page, l'éditeur les deux (`localizeRecruitmentAds`). Un visiteur ne
  // reçoit que la langue de la page (`publicRecruitmentAds`).
  const ads = await listRecruitmentAds(isAdmin);
  const publicView = isAdmin ? undefined : publicRecruitmentAds(ads, locale);
  // Coordonnées du recruteur pour pré-remplir le formulaire (édition libre).
  const contactDefaults: RecruiterContactDefaults =
    isAdmin && user
      ? await getRecruiterContactDefaults(user.id)
      : { discord: null, discordId: null };

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

      {/* L'anglais ne voyage que sous `/en` : le français est dans le paquet. */}
      <RecruitmentTextProvider
        locale={locale}
        messages={locale === DEFAULT_LOCALE ? undefined : recruitmentClientMessages(messages)}
      >
        <RecruitmentSection
          initialAds={publicView?.ads ?? ads}
          hiddenAds={publicView?.hidden}
          isAdmin={isAdmin}
          contactDefaults={contactDefaults}
        />
      </RecruitmentTextProvider>
    </PublicPageShell>
  );
}
