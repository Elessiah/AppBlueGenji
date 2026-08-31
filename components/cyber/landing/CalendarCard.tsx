import { formatLocalDateTime } from "@/lib/shared/dates";
import { inferGameShortLabel, type LandingCalendarEvent } from "@/lib/shared/landing";
import styles from "./CalendarCard.module.css";

type CalendarCardProps = {
  events: LandingCalendarEvent[];
};

function monthLabel(date: Date): string {
  return date.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "").toUpperCase();
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString("fr-FR", { day: "2-digit" });
}

function tagLabel(state: LandingCalendarEvent["state"]): string {
  if (state === "RUNNING") return "EN COURS";
  if (state === "REGISTRATION") return "OPEN";
  if (state === "FINISHED") return "ARCHIVE";
  return "OPEN";
}

export function CalendarCard({ events }: CalendarCardProps) {
  return (
    <div id="calendrier" className={styles.root}>
      <div className={styles.head}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "var(--ink-mute)" }}>PROCHAINS ÉVÉNEMENTS</span>
        <a className="mono" href="/api/landing/calendar?format=ics" download="bluegenji.ics">
          ICS →
        </a>
      </div>

      <div className={styles.list}>
        {events.map((event) => {
          const date = new Date(event.startAt);
          return (
            <div key={event.tournamentId} className={styles.row}>
              <div className={styles.date}>
                <div className="num">{dayLabel(date)}</div>
                <div className="mono">{monthLabel(date)}</div>
              </div>
              <div className={styles.bar} />
              <div className={styles.body}>
                <div className={styles.pills}>
                  <span className={styles.pill}>{inferGameShortLabel(event.name)}</span>
                  <span className={styles.tag}>{tagLabel(event.state)}</span>
                </div>
                <div className={styles.title} title={formatLocalDateTime(date)}>
                  {event.name}
                </div>
              </div>
              <div className="num mono">{date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
