import { CalendarCard } from "./CalendarCard";
import { Leaderboard } from "./Leaderboard";
import type { LandingCalendarEvent, LandingLeaderboardRow } from "@/lib/shared/landing";
import { landingServerText } from "@/lib/server/i18n-landing";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import styles from "./LeaderCal.module.css";

type LeaderCalProps = {
  leaderboard: LandingLeaderboardRow[];
  events: LandingCalendarEvent[];
  /** Langue de la page (`requestLocale()`), français par défaut. */
  locale?: Locale;
  /** Visiteur sans session : l'agenda mène à la page sans compte (`SPECTATOR_VIEW.md`). */
  spectator?: boolean;
};

export function LeaderCal({ leaderboard, events, locale = DEFAULT_LOCALE, spectator = false }: Readonly<LeaderCalProps>) {
  const { t } = landingServerText(locale);
  const rankedCount = leaderboard.length;
  return (
    <section id="equipes" className={styles.root}>
      <div className={styles.head}>
        <h2 className={styles.sectionTitle}>{t("leaderCal.title")}</h2>
        <div className={styles.meta}>{t("leaderCal.rankedCount", { count: rankedCount })}</div>
      </div>

      <div className={styles.grid}>
        <Leaderboard initialRows={leaderboard} />
        <CalendarCard events={events} locale={locale} spectator={spectator} />
      </div>
    </section>
  );
}
