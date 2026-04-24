import { CalendarCard } from "./CalendarCard";
import { Leaderboard } from "./Leaderboard";
import type { LandingCalendarEvent, LandingLeaderboardRow } from "@/lib/shared/landing";
import styles from "./LeaderCal.module.css";

type LeaderCalProps = {
  leaderboard: LandingLeaderboardRow[];
  events: LandingCalendarEvent[];
};

export function LeaderCal({ leaderboard, events }: LeaderCalProps) {
  return (
    <section id="equipes" className={styles.root}>
      <div className={styles.head}>
        <div>
          <span className="eyebrow">SECTION 02</span>
          <h2 className={styles.sectionTitle}>Classement et calendrier</h2>
        </div>
        <div className={styles.meta}>SAISON EN COURS</div>
      </div>

      <div className={styles.grid}>
        <Leaderboard initialRows={leaderboard} />
        <CalendarCard events={events} />
      </div>
    </section>
  );
}

