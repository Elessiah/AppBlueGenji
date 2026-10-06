import { localizedAboutPillars, type AboutPillar } from "@/lib/shared/about-pillars";
import { localizedAboutStats, type AboutStat } from "@/lib/shared/about-stats";
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
 * Sous `/en`, les chiffres et les cartes « À propos » ne sont rendus qu'avec
 * leur anglais, saisi dans leur éditeur depuis le lot 5b (D9) ; ceux d'avant,
 * sans anglais, attendent le rattrapage (`staff-translation.ts`). Mieux vaut
 * une section plus courte qu'une page anglaise semée de français.
 */
export function AboutSection({ stats, pillars, isAdmin, copy, locale = DEFAULT_LOCALE }: Readonly<AboutSectionProps>) {
  const { t } = landingServerText(locale);
  // Chaque colonne n'est posée que si elle a quelque chose à montrer dans la
  // langue de la page — sauf pour la gestion, qui y ajoute ses cartes.
  const showStats = isAdmin || localizedAboutStats(stats, locale).length > 0;
  const showPillars = isAdmin || localizedAboutPillars(pillars, locale).length > 0;
  return (
    <section id="assoc" className={styles.root}>
      <div className={styles.head}>
        <div>
          <EditableCopy copyKey="home.about.title" value={copy["home.about.title"]} canEdit={isAdmin}>
            <h2 className={styles.sectionTitle}>{copy["home.about.title"]}</h2>
          </EditableCopy>
        </div>
        <div className={styles.meta}>{t("about.meta", { year: ORGANIZATION_FOUNDING_YEAR })}</div>
      </div>

      {/* Sans cartes « À propos » traduites, une seule colonne : la seconde
          resterait vide. */}
      <div className={showPillars ? styles.grid : `${styles.grid} ${styles.gridSingle}`}>
        <div className={styles.left}>
          <EditableCopy copyKey="home.about.lede" value={copy["home.about.lede"]} canEdit={isAdmin}>
            <p className={styles.lede}>{copy["home.about.lede"]}</p>
          </EditableCopy>

          {showStats && <AboutStats initialStats={stats} isAdmin={isAdmin} locale={locale} />}
        </div>

        {showPillars && (
          <div className={styles.right}>
            <AboutPillars initialPillars={pillars} isAdmin={isAdmin} locale={locale} />
          </div>
        )}
      </div>
    </section>
  );
}
