import type { AboutPillar } from "@/lib/shared/about-pillars";
import type { AboutStat } from "@/lib/shared/about-stats";
import type { SiteCopy } from "@/lib/shared/site-copy";
import { AboutPillars } from "./AboutPillars";
import { AboutStats } from "./AboutStats";
import { EditableCopy } from "./EditableCopy";
import styles from "./AboutSection.module.css";

interface AboutSectionProps {
  stats: AboutStat[];
  pillars: AboutPillar[];
  isAdmin: boolean;
  copy: SiteCopy;
}

export function AboutSection({ stats, pillars, isAdmin, copy }: AboutSectionProps) {
  return (
    <section id="assoc" className={styles.root}>
      <div className={styles.head}>
        <div>
          <span className="eyebrow">SECTION 03</span>
          <EditableCopy copyKey="home.about.title" value={copy["home.about.title"]} canEdit={isAdmin}>
            <h2 className={styles.sectionTitle}>{copy["home.about.title"]}</h2>
          </EditableCopy>
        </div>
        <div className={styles.meta}>LOI 1901 · JANVILLIERS · 2020</div>
      </div>

      <div className={styles.grid}>
        <div className={styles.left}>
          <EditableCopy copyKey="home.about.lede" value={copy["home.about.lede"]} canEdit={isAdmin}>
            <p className={styles.lede}>{copy["home.about.lede"]}</p>
          </EditableCopy>

          <AboutStats initialStats={stats} isAdmin={isAdmin} />
        </div>

        <div className={styles.right}>
          <AboutPillars initialPillars={pillars} isAdmin={isAdmin} />
        </div>
      </div>
    </section>
  );
}
