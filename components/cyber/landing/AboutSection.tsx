import type { AboutPillar } from "@/lib/shared/about-pillars";
import type { AboutStat } from "@/lib/shared/about-stats";
import type { SiteCopy } from "@/lib/shared/site-copy";
import { ORGANIZATION_FOUNDING_YEAR } from "@/lib/shared/structured-data";
import { landingServerText } from "@/lib/server/i18n-landing";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { AboutPillars } from "./AboutPillars";
import { AboutStats } from "./AboutStats";
import { EditableCopy } from "./EditableCopy";
import styles from "./AboutSection.module.css";

interface AboutSectionProps {
  stats: AboutStat[];
  pillars: AboutPillar[];
  isAdmin: boolean;
  copy: SiteCopy;
  /** Langue de la page (`requestLocale()`), français par défaut. */
  locale?: Locale;
}

/**
 * Section « L'association » de l'accueil (et de la page association).
 *
 * Sous `/en`, les chiffres et les cartes « À propos » ne sont **pas** rendus :
 * leur texte est saisi en français par le staff, et leur éditeur ne demande
 * l'anglais qu'au lot 5 (`docs/features/I18N_MIGRATION_PLAN.md`, D9). Mieux
 * vaut une section plus courte qu'une page anglaise semée de français.
 */
export function AboutSection({ stats, pillars, isAdmin, copy, locale = DEFAULT_LOCALE }: Readonly<AboutSectionProps>) {
  const { t } = landingServerText(locale);
  const showStaffContent = locale === DEFAULT_LOCALE;
  return (
    <section id="assoc" className={styles.root}>
      <div className={styles.head}>
        <div>
          <EditableCopy copyKey="home.about.title" value={copy["home.about.title"]} canEdit={isAdmin}>
            <h2 className={styles.sectionTitle}>{copy["home.about.title"]}</h2>
          </EditableCopy>
        </div>
        <div className={styles.meta}>{t("about.meta", { year: String(ORGANIZATION_FOUNDING_YEAR) })}</div>
      </div>

      <div className={styles.grid}>
        <div className={styles.left}>
          <EditableCopy copyKey="home.about.lede" value={copy["home.about.lede"]} canEdit={isAdmin}>
            <p className={styles.lede}>{copy["home.about.lede"]}</p>
          </EditableCopy>

          {showStaffContent && <AboutStats initialStats={stats} isAdmin={isAdmin} />}
        </div>

        {showStaffContent && (
          <div className={styles.right}>
            <AboutPillars initialPillars={pillars} isAdmin={isAdmin} />
          </div>
        )}
      </div>
    </section>
  );
}
