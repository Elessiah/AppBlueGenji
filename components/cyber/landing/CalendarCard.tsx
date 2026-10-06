import type { LandingCalendarEvent } from "@/lib/shared/landing";
import { tournamentMatchHref } from "@/lib/shared/match-anchor";
import { landingServerText } from "@/lib/server/i18n-landing";
import { BOARD_TIME_ZONE } from "@/lib/shared/landing-board";
import { LANDING_INTL_LOCALE } from "@/lib/shared/landing-text";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import styles from "./CalendarCard.module.css";

type CalendarCardProps = {
  events: LandingCalendarEvent[];
  /** Langue de la page (`requestLocale()`), français par défaut. */
  locale?: Locale;
};

function monthLabel(date: Date, tag: string): string {
  return date.toLocaleDateString(tag, { month: "short", timeZone: BOARD_TIME_ZONE }).replace(".", "").toUpperCase();
}

function dayLabel(date: Date, tag: string): string {
  return date.toLocaleDateString(tag, { day: "2-digit", timeZone: BOARD_TIME_ZONE });
}

// `getLandingCalendar` n'envoie plus jamais `RUNNING` ni `FINISHED` — le
// calendrier ne montre que ce qui arrive — mais le type accepte encore les
// quatre états : mieux vaut un libellé qui reste juste pour tous que de
// planter sur un état devenu impossible.
function tagKey(state: LandingCalendarEvent["state"]): "running" | "registration" | "finished" | "soon" {
  if (state === "RUNNING") return "running";
  if (state === "REGISTRATION") return "registration";
  if (state === "FINISHED") return "finished";
  return "soon";
}

export function CalendarCard({ events, locale = DEFAULT_LOCALE }: Readonly<CalendarCardProps>) {
  const { t } = landingServerText(locale);
  const tag = LANDING_INTL_LOCALE[locale];
  return (
    <div id="calendrier" className={styles.root}>
      <div className={styles.head}>
        <h3 className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "var(--ink-mute)", margin: 0, fontWeight: 400 }}>
          {t("calendar.heading")}
        </h3>
        <a className="mono" href={locale === "en" ? "/api/landing/calendar?format=ics&lang=en" : "/api/landing/calendar?format=ics"} download="bluegenji.ics">
          {t("calendar.ics")}
        </a>
      </div>

      {events.length === 0 && <p className={styles.empty}>{t("calendar.empty")}</p>}

      <div className={styles.list}>
        {events.map((event) => {
          const date = new Date(event.startAt);
          return (
            <div key={event.tournamentId} className={styles.row}>
              <div className={styles.date}>
                <div className="num">{dayLabel(date, tag)}</div>
                <div className="mono">{monthLabel(date, tag)}</div>
              </div>
              <div className={styles.bar} />
              <div className={styles.body}>
                <div className={styles.pills}>
                  <span className={styles.pill}>{event.game}</span>
                  <span className={styles.tag}>{t(`calendar.tag.${tagKey(event.state)}`)}</span>
                </div>
                {/* Le nom porte le lien, étiré sur toute la ligne par un
                    `::after` : la ligne entière mène à la fiche, et le nom
                    accessible du lien reste celui du tournoi — pas la date,
                    le jeu et l'état concaténés. */}
                <div className={styles.title} title={date.toLocaleString(tag, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: BOARD_TIME_ZONE, timeZoneName: "short" })}>
                  <a className={styles.link} href={tournamentMatchHref(event.tournamentId)}>
                    {event.name}
                  </a>
                </div>
              </div>
              <div className={`num mono ${styles.time}`}>{date.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: BOARD_TIME_ZONE })}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
