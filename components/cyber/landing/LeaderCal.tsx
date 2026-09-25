import { CalendarCard } from "./CalendarCard";
import { Leaderboard } from "./Leaderboard";
import type { LandingCalendarEvent, LandingLeaderboardRow } from "@/lib/shared/landing";
import styles from "./LeaderCal.module.css";

type LeaderCalProps = {
  leaderboard: LandingLeaderboardRow[];
  events: LandingCalendarEvent[];
};

export function LeaderCal({ leaderboard, events }: LeaderCalProps) {
  const rankedCount = leaderboard.length;
  return (
    <section id="equipes" className={styles.root}>
      <div className={styles.head}>
        <h2 className={styles.sectionTitle}>Classement et calendrier</h2>
        <div className={styles.meta}>
          {rankedCount} {rankedCount > 1 ? "ÉQUIPES CLASSÉES" : "ÉQUIPE CLASSÉE"}
        </div>
      </div>

      <div className={styles.grid}>
        <Leaderboard initialRows={leaderboard} />
        <CalendarCard events={events} />
      </div>
    </section>
  );
}

