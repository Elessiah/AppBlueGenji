import { formatLocalDateTime } from "@/lib/shared/dates";
import type { LandingCalendarEvent } from "@/lib/shared/landing";
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

// `getLandingCalendar` n'envoie plus jamais `RUNNING` ni `FINISHED` — le
// calendrier ne montre que ce qui arrive — mais le type accepte encore les
// quatre états : mieux vaut un libellé qui reste juste pour tous que de
// planter sur un état devenu impossible.
function tagLabel(state: LandingCalendarEvent["state"]): string {
  if (state === "RUNNING") return "EN COURS";
  if (state === "REGISTRATION") return "INSCRIPTIONS OUVERTES";
  if (state === "FINISHED") return "ARCHIVE";
  return "BIENTÔT";
}

export function CalendarCard({ events }: CalendarCardProps) {
  return (
    <div id="calendrier" className={styles.root}>
      <div className={styles.head}>
        <h3 className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "var(--ink-mute)", margin: 0, fontWeight: 400 }}>
          PROCHAINS ÉVÉNEMENTS
        </h3>
        <a className="mono" href="/api/landing/calendar?format=ics" download="bluegenji.ics">
          Ajouter à mon agenda (.ics)
        </a>
      </div>

      {events.length === 0 && <p className={styles.empty}>Aucun tournoi programmé.</p>}

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
                  <span className={styles.pill}>{event.game}</span>
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
