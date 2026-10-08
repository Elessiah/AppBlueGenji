import type { LandingCalendarEvent } from "@/lib/shared/landing";
import { LocaleLink } from "@/components/i18n/locale-navigation";
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
  /** Visiteur sans session : les liens mènent à la page sans compte (`SPECTATOR_VIEW.md`). */
  spectator?: boolean;
};

// Formateurs construits une fois par langue (une construction coûte bien plus
// qu'un formatage), comme ceux du plateau (`landing-board.ts`).
type CalendarFormats = { month: Intl.DateTimeFormat; day: Intl.DateTimeFormat; full: Intl.DateTimeFormat; time: Intl.DateTimeFormat };

function buildFormats(tag: string): CalendarFormats {
  return {
    month: new Intl.DateTimeFormat(tag, { month: "short", timeZone: BOARD_TIME_ZONE }),
    day: new Intl.DateTimeFormat(tag, { day: "2-digit", timeZone: BOARD_TIME_ZONE }),
    full: new Intl.DateTimeFormat(tag, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: BOARD_TIME_ZONE,
      timeZoneName: "short",
    }),
    time: new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: BOARD_TIME_ZONE }),
  };
}

const CALENDAR_FORMATS: Readonly<Record<Locale, CalendarFormats>> = {
  fr: buildFormats(LANDING_INTL_LOCALE.fr),
  en: buildFormats(LANDING_INTL_LOCALE.en),
};

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

export function CalendarCard({ events, locale = DEFAULT_LOCALE, spectator = false }: Readonly<CalendarCardProps>) {
  const { t } = landingServerText(locale);
  const formats = CALENDAR_FORMATS[locale];
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
                <div className="num">{formats.day.format(date)}</div>
                <div className="mono">{formats.month.format(date).replace(".", "").toUpperCase()}</div>
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
                <div className={styles.title} title={formats.full.format(date)}>
                  <LocaleLink className={styles.link} href={tournamentMatchHref(event.tournamentId, null, spectator)}>
                    {event.name}
                  </LocaleLink>
                </div>
              </div>
              <div className={`num mono ${styles.time}`}>{formats.time.format(date)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
