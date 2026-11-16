"use client";

import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { ScrollArea } from "@/components/cyber/ScrollArea";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import {
  AUDIENCE_RANGES,
  fillDailySeries,
  fillTemplate,
  formatDuration,
  groupDaily,
  heatmapMargins,
  kpisOf,
  percentShares,
  rangeStart,
  relativeChange,
  shiftDay,
  type AudienceBucket,
  type AudienceDailyPoint,
  type AudienceRange,
  type AudienceShare,
  type AudienceStats,
} from "@/lib/shared/audience";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import { SOURCE_CODE_URL } from "@/lib/shared/source-code";
import { AudienceChart } from "./AudienceChart";
import styles from "./frequentation.module.css";

type AudienceMessages = Messages["audience"];

/** Au-delà de ce nombre de jours, la courbe passe à la semaine, puis au mois. */
const WEEKLY_FROM_DAYS = 92;
const MONTHLY_FROM_DAYS = 731;
/** Barres montrées par regroupement : six mois de semaines, deux ans de mois. */
const BUCKET_LIMITS: Record<Exclude<AudienceBucket, "day">, number> = { week: 26, month: 24, year: 50 };
/** Teintes catégorielles, dans l'ordre fixe (jamais recyclées). */
const SERIES_TONES = ["--st-series-1", "--st-series-2", "--st-series-3", "--st-series-4", "--st-series-5", "--st-series-6"];
/** Paliers de la carte de chaleur (`--st-heat-0` = aucune page vue). */
const HEAT_LEVELS = 5;

/** Flèche d'une évolution : la hausse n'est pas jugée, seulement montrée. */
function changeArrow(change: number): string {
  if (change > 0) return "↑ ";
  if (change < 0) return "↓ ";
  return "→ ";
}

/** Pas de la courbe d'évolution selon la longueur de la période. */
function evolutionBucket(days: number): AudienceBucket {
  if (days > MONTHLY_FROM_DAYS) return "month";
  if (days > WEEKLY_FROM_DAYS) return "week";
  return "day";
}

function dateOf(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function useFormatters(locale: Locale) {
  return useMemo(() => {
    const numbers = new Intl.NumberFormat(locale);
    const decimals = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
    const signed = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });
    const longDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const shortDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    const monthYear = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" });
    const monthLong = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
    return {
      number: (value: number) => numbers.format(Math.round(value)),
      decimal: (value: number) => decimals.format(value),
      percent: (value: number) => percent.format(value),
      signed: (value: number) => signed.format(value),
      longDate: (day: string) => longDate.format(dateOf(day)),
      shortDate: (day: string) => shortDate.format(dateOf(day)),
      month: (key: string) => monthYear.format(dateOf(`${key}-01`)),
      monthLong: (key: string) => monthLong.format(dateOf(`${key}-01`)),
    };
  }, [locale]);
}

type Formatters = ReturnType<typeof useFormatters>;

/** Libellés court (axe) et long (info-bulle, tableau) d'un point regroupé. */
function bucketLabels(key: string, bucket: AudienceBucket, m: AudienceMessages, f: Formatters): { short: string; long: string } {
  if (bucket === "year") return { short: key, long: key };
  if (bucket === "month") return { short: f.month(key), long: f.monthLong(key) };
  if (bucket === "week") return { short: f.shortDate(key), long: fillTemplate(m.buckets.weekOf, { date: f.longDate(key) }) };
  return { short: f.shortDate(key), long: f.longDate(key) };
}

/** Bouton bascule d'un groupe de choix (période, regroupement). */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className={styles.segmented} data-tap-zone>
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segment}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

/** Tableau de données repliable sous un graphique (accessibilité, lecture exacte). */
function DataTable({ m, caption, columns, rows }: { m: AudienceMessages; caption: string; columns: string[]; rows: string[][] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={styles.dataTable}>
      <button type="button" className={styles.linkButton} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {open ? m.table.hide : m.table.show}
      </button>
      <div id={id} hidden={!open}>
        {open && (
          <ScrollArea ariaLabel={caption}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>{caption}</caption>
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th key={column} scope="col" className={index > 0 ? styles.num : undefined}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) =>
                    index === 0 ? (
                      <th key={index} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={index} className={styles.num}>
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

/** Titre suivi, s'il y a lieu, de son explication derrière le bouton « i » (`INFO_HINTS.md`). */
function Titled({ children, hint, subject }: { children: ReactNode; hint?: string; subject: string }) {
  const id = useId();
  if (!hint) return <>{children}</>;
  return (
    <InfoHintRow>
      {children}
      <InfoHint id={`${id}-hint`} subject={subject}>
        <p>{hint}</p>
      </InfoHint>
    </InfoHintRow>
  );
}

function Card({ title, hint, children, wide = false }: { title: string; hint?: string; children: ReactNode; wide?: boolean }) {
  const id = useId();
  return (
    <section className={`${styles.card} ${wide ? styles.wide : ""}`} aria-labelledby={id}>
      <Titled hint={hint} subject={title}>
        <h2 id={id} className={styles.cardTitle}>
          {title}
        </h2>
      </Titled>
      {children}
    </section>
  );
}

/** Barre segmentée d'une répartition (appareils, provenance, langue), légende chiffrée dessous. */
function ShareBar({ title, shares, labels, hint, f }: { title: string; shares: AudienceShare[]; labels: Record<string, string>; hint?: string; f: Formatters }) {
  const known = shares.filter((share) => share.key in labels);
  const percents = percentShares(known.map((share) => share.views));
  return (
    <div className={styles.share}>
      <Titled hint={hint} subject={title}>
        <h3 className={styles.shareTitle}>{title}</h3>
      </Titled>
      <div className={styles.shareBar} aria-hidden="true">
        {known.map((share, index) =>
          percents[index] > 0 ? (
            <span
              key={share.key}
              className={styles.shareSegment}
              style={{ flexGrow: share.views, background: `var(${SERIES_TONES[index % SERIES_TONES.length]})` }}
              title={`${labels[share.key]} — ${f.percent(percents[index] / 100)}`}
            />
          ) : null,
        )}
      </div>
      <ul className={styles.legend}>
        {known.map((share, index) => (
          <li key={share.key}>
            <span className={styles.swatch} style={{ background: `var(${SERIES_TONES[index % SERIES_TONES.length]})` }} aria-hidden="true" />
            <span className={styles.legendLabel}>{labels[share.key]}</span>
            <span className={styles.legendValue}>
              {f.percent(percents[index] / 100)} · {f.number(share.views)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ordre fixe des catégories d'une répartition, pour que la couleur suive la catégorie et non son rang. */
function inOrder(shares: AudienceShare[], order: readonly string[]): AudienceShare[] {
  const byKey = new Map(shares.map((share) => [share.key, share]));
  return order.map((key) => byKey.get(key) ?? { key, views: 0, visitors: 0 });
}

export interface AudienceDashboardProps {
  stats: AudienceStats | null;
  messages: AudienceMessages;
  locale: Locale;
}

/**
 * Tableau de bord de `/frequentation` (`docs/features/STATS_PAGE.md`) : tout
 * se calcule ici à partir des agrégats quotidiens remis par le serveur ;
 * changer de période ne refait aucune requête.
 */
export function AudienceDashboard({ stats, messages: m, locale }: AudienceDashboardProps) {
  const f = useFormatters(locale);
  const [range, setRange] = useState<AudienceRange>("30d");
  const [bucket, setBucket] = useState<Exclude<AudienceBucket, "day">>("week");
  const [hovered, setHovered] = useState<{ day: number; hour: number } | null>(null);

  const lastDay = stats?.lastDay ?? null;
  const firstDay = stats?.firstDay ?? null;
  const formatNumber = useCallback((value: number) => f.number(value), [f]);

  const period = useMemo(() => {
    if (!stats || !lastDay || !firstDay) return null;
    const start = rangeStart(range, lastDay);
    const from = start && start > firstDay ? start : firstDay;
    // Une période ouverte avant la première mesure commence à celle-ci : des jours
    // sans mesure ne sont pas des jours sans visite.
    const points = fillDailySeries(stats.daily, from, lastDay);
    let previous: AudienceDailyPoint[] | null = null;
    if (start) {
      const prevTo = shiftDay(start, -1);
      const prevFrom = shiftDay(start, -points.length);
      if (start === from && prevFrom >= firstDay) previous = fillDailySeries(stats.daily, prevFrom, prevTo);
    }
    return { from, points, previous };
  }, [stats, range, lastDay, firstDay]);

  const header = (
    <header className={styles.header}>
      <p className={styles.eyebrow}>{m.header.eyebrow}</p>
      <h1 className={styles.title}>{m.header.title}</h1>
      <p className={styles.lead}>{m.header.lead}</p>
      {lastDay && firstDay && (
        <p className={styles.meta}>
          <span>{fillTemplate(m.header.updated, { date: f.longDate(lastDay) })}</span>
          <span aria-hidden="true"> · </span>
          <span>{fillTemplate(m.header.since, { date: f.longDate(firstDay) })}</span>
        </p>
      )}
    </header>
  );

  const footer = (
    <footer className={styles.footer}>
      <section aria-labelledby="audience-method">
        <h2 id="audience-method" className={styles.footerTitle}>
          {m.method.title}
        </h2>
        <ul className={styles.methodList}>
          {m.method.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <p className={styles.footerLinks}>
        <span>{m.method.association}</span>
        <LocaleLink href="/rgpd#audience-detaillee" className={styles.link}>
          {m.method.privacy}
        </LocaleLink>
        <a href={SOURCE_CODE_URL} className={styles.link} rel="noopener noreferrer" target="_blank">
          {m.method.sourceCode}
        </a>
        <LocaleLink href="/" className={styles.link}>
          {m.header.home}
        </LocaleLink>
      </p>
    </footer>
  );

  if (!stats || !period || !lastDay) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          {header}
          <main id="contenu" className={styles.main}>
            <section className={`${styles.card} ${styles.empty}`} aria-labelledby="audience-empty">
              <h2 id="audience-empty" className={styles.cardTitle}>
                {m.empty.title}
              </h2>
              <p className={styles.cardHint}>{m.empty.body}</p>
            </section>
            {stats?.community && <Community m={m} community={stats.community} f={f} />}
          </main>
          {footer}
        </div>
      </div>
    );
  }

  const kpis = kpisOf(period.points);
  const previousKpis = period.previous ? kpisOf(period.previous) : null;
  const tiles: { key: string; label: string; value: string; change: number | null; hint?: string }[] = [
    { key: "visitors", label: m.kpis.visitors, value: f.number(kpis.visitors), change: previousKpis && relativeChange(kpis.visitors, previousKpis.visitors), hint: m.kpis.visitorsHint },
    { key: "views", label: m.kpis.views, value: f.number(kpis.views), change: previousKpis && relativeChange(kpis.views, previousKpis.views) },
    { key: "visits", label: m.kpis.visits, value: f.number(kpis.visits), change: previousKpis && relativeChange(kpis.visits, previousKpis.visits) },
    { key: "perDay", label: m.kpis.avgVisitorsPerDay, value: f.decimal(kpis.avgVisitorsPerDay), change: previousKpis && relativeChange(kpis.avgVisitorsPerDay, previousKpis.avgVisitorsPerDay) },
    { key: "timeVisit", label: m.kpis.avgTimePerVisit, value: formatDuration(kpis.avgSecondsPerVisit), change: previousKpis && relativeChange(kpis.avgSecondsPerVisit, previousKpis.avgSecondsPerVisit) },
    { key: "timePage", label: m.kpis.avgTimePerPage, value: formatDuration(kpis.avgSecondsPerPage), change: previousKpis && relativeChange(kpis.avgSecondsPerPage, previousKpis.avgSecondsPerPage) },
    { key: "pagesVisit", label: m.kpis.pagesPerVisit, value: f.decimal(kpis.pagesPerVisit), change: previousKpis && relativeChange(kpis.pagesPerVisit, previousKpis.pagesPerVisit) },
    { key: "bounce", label: m.kpis.bounceRate, value: f.percent(kpis.bounceRate), change: previousKpis && relativeChange(kpis.bounceRate, previousKpis.bounceRate) },
  ];

  const rangeStats = stats.ranges[range];

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        {header}

        <main id="contenu" className={styles.main}>
        <div className={styles.toolbar}>
          <Segmented
            label={m.ranges.label}
            value={range}
            onChange={setRange}
            options={AUDIENCE_RANGES.map((value) => ({ value, label: m.ranges[value] }))}
          />
        </div>

        <section aria-label={m.kpis.label} className={styles.kpis}>
          {tiles.map((tile) => (
            <div key={tile.key} className={styles.kpi}>
              <Titled hint={tile.hint} subject={tile.label}>
                <p className={styles.kpiLabel}>{tile.label}</p>
              </Titled>
              <p className={styles.kpiValue}>{tile.value}</p>
              <p className={styles.kpiChange}>
                {tile.change === null ? (
                  m.kpis.noPrevious
                ) : (
                  <>
                    <span aria-hidden="true">{changeArrow(tile.change)}</span>
                    {fillTemplate(m.kpis.vsPrevious, { change: f.signed(tile.change) })}
                  </>
                )}
              </p>
            </div>
          ))}
        </section>

        <div className={styles.grid}>
          <Evolution m={m} f={f} points={period.points} formatNumber={formatNumber} />
          <Buckets m={m} f={f} stats={stats} bucket={bucket} onBucket={setBucket} formatNumber={formatNumber} />
          <Pages m={m} f={f} pages={rangeStats.pages} />
          <Card title={m.timing.heatmapTitle} hint={m.timing.heatmapHint} wide>
            <Heatmap m={m} f={f} heatmap={rangeStats.heatmap} hovered={hovered} onHover={setHovered} formatNumber={formatNumber} />
          </Card>
          <Card title={m.audience.title} wide>
            <div className={styles.shares}>
              <ShareBar
                title={m.audience.devices}
                shares={inOrder(rangeStats.devices, ["desktop", "mobile", "tablet"])}
                labels={m.audience.deviceLabels}
                f={f}
              />
              <ShareBar
                title={m.audience.sources}
                hint={m.audience.sourcesHint}
                shares={inOrder(rangeStats.sources, ["direct", "search", "discord", "social", "video", "other"])}
                labels={m.audience.sourceLabels}
                f={f}
              />
              <ShareBar title={m.audience.locales} shares={inOrder(rangeStats.locales, ["fr", "en"])} labels={m.audience.localeLabels} f={f} />
            </div>
          </Card>
        </div>

        {stats.community && <Community m={m} community={stats.community} f={f} />}
        </main>
        {footer}
      </div>
    </div>
  );
}

function Evolution({ m, f, points, formatNumber }: { m: AudienceMessages; f: Formatters; points: AudienceDailyPoint[]; formatNumber: (value: number) => string }) {
  const bucket = evolutionBucket(points.length);
  // Regroupés par semaine ou par mois, les visiteurs quotidiens s'additionnent : le libellé le dit.
  const visitorsLabel = bucket === "day" ? m.evolution.visitors : m.evolution.visitorsSummed;
  const hints: Record<AudienceBucket, string> = { day: m.evolution.hint, week: m.evolution.hintWeekly, month: m.evolution.hintMonthly, year: m.evolution.hintMonthly };
  const hint = hints[bucket];
  const chart = useMemo(() => {
    const grouped = bucket === "day" ? points.map((point) => ({ ...point, key: point.day })) : groupDaily(points, bucket);
    const labels = grouped.map((point) => bucketLabels(point.key, bucket, m, f));
    return {
      labels: labels.map((label) => label.short),
      long: labels.map((label) => label.long),
      series: [
        { label: visitorsLabel, data: grouped.map((point) => point.visitors), tone: "--st-series-1" },
        { label: m.evolution.views, data: grouped.map((point) => point.views), tone: "--st-series-2" },
      ],
      rows: grouped.map((point, index) => [labels[index].long, f.number(point.visitors), f.number(point.views)]),
    };
  }, [points, bucket, m, f, visitorsLabel]);
  return (
    <Card title={m.evolution.title} hint={hint} wide>
      <ul className={styles.legend} aria-hidden="true">
        {chart.series.map((serie) => (
          <li key={serie.label}>
            <span className={styles.swatchLine} style={{ background: `var(${serie.tone})` }} />
            <span className={styles.legendLabel}>{serie.label}</span>
          </li>
        ))}
      </ul>
      <AudienceChart
        type="line"
        labels={chart.labels}
        tooltipLabels={chart.long}
        series={chart.series}
        ariaLabel={m.evolution.title}
        loadingLabel={m.chart.loading}
        tooltipTemplate={m.chart.tooltip}
        formatValue={formatNumber}
        height={260}
      />
      <DataTable m={m} caption={m.evolution.title} columns={[m.table.period, visitorsLabel, m.evolution.views]} rows={chart.rows} />
    </Card>
  );
}

function Buckets({
  m,
  f,
  stats,
  bucket,
  onBucket,
  formatNumber,
}: {
  m: AudienceMessages;
  f: Formatters;
  stats: AudienceStats;
  bucket: Exclude<AudienceBucket, "day">;
  onBucket: (bucket: Exclude<AudienceBucket, "day">) => void;
  formatNumber: (value: number) => string;
}) {
  const chart = useMemo(() => {
    const all = stats.firstDay && stats.lastDay ? fillDailySeries(stats.daily, stats.firstDay, stats.lastDay) : [];
    const grouped = groupDaily(all, bucket).slice(-BUCKET_LIMITS[bucket]);
    const labels = grouped.map((point) => bucketLabels(point.key, bucket, m, f));
    return {
      labels: labels.map((label) => label.short),
      long: labels.map((label) => label.long),
      series: [{ label: m.kpis.visitors, data: grouped.map((point) => point.visitors), tone: "--st-series-1" }],
      rows: grouped.map((point, index) => [labels[index].long, f.number(point.visitors)]),
    };
  }, [stats, bucket, m, f]);
  return (
    <Card title={m.buckets.title} hint={m.buckets.hint}>
      <Segmented
        label={m.buckets.label}
        value={bucket}
        onChange={onBucket}
        options={(["week", "month", "year"] as const).map((value) => ({ value, label: m.buckets[value] }))}
      />
      <AudienceChart
        type="bar"
        labels={chart.labels}
        tooltipLabels={chart.long}
        series={chart.series}
        ariaLabel={m.buckets.title}
        loadingLabel={m.chart.loading}
        tooltipTemplate={m.chart.tooltip}
        formatValue={formatNumber}
      />
      <DataTable m={m} caption={m.buckets.title} columns={[m.table.period, m.kpis.visitors]} rows={chart.rows} />
    </Card>
  );
}

function Pages({ m, f, pages }: { m: AudienceMessages; f: Formatters; pages: AudienceStats["ranges"][AudienceRange]["pages"] }) {
  const labels: Record<string, string> = m.pages.labels;
  const sorted = [...pages].filter((page) => page.views > 0).sort((a, b) => b.views - a.views);
  const percents = percentShares(sorted.map((page) => page.views));
  const max = sorted[0]?.views ?? 0;
  return (
    <Card title={m.pages.title} hint={m.pages.hint}>
      <ol className={styles.pages}>
        {sorted.map((page, index) => (
          <li key={page.key} className={styles.pageRow}>
            <div className={styles.pageHead}>
              <span className={styles.pageName}>{labels[page.key] ?? labels.other}</span>
              <span className={styles.pageViews}>{f.number(page.views)}</span>
            </div>
            <div className={styles.pageTrack} aria-hidden="true">
              <span className={styles.pageFill} style={{ width: `${max > 0 ? Math.max(2, (page.views / max) * 100) : 0}%` }} />
            </div>
            <p className={styles.pageMeta}>
              <span>
                {m.pages.share} {f.percent(percents[index] / 100)}
              </span>
              <span>
                {m.pages.avgTime} {formatDuration(page.views > 0 ? page.engagedMs / page.views / 1000 : 0)}
              </span>
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Heatmap({
  m,
  f,
  heatmap,
  hovered,
  onHover,
  formatNumber,
}: {
  m: AudienceMessages;
  f: Formatters;
  heatmap: number[][];
  hovered: { day: number; hour: number } | null;
  onHover: (cell: { day: number; hour: number } | null) => void;
  formatNumber: (value: number) => string;
}) {
  const max = Math.max(0, ...heatmap.flat());
  const hourLabel = useCallback((hour: number) => fillTemplate(m.timing.hourLabel, { hour }), [m]);
  // Stables d'un survol à l'autre : un tableau neuf recréerait les deux graphiques à chaque case survolée.
  const marginCharts = useMemo(() => {
    const margins = heatmapMargins(heatmap);
    return {
      weekdayLabels: [...m.timing.weekdaysShort],
      weekdayTooltips: [...m.timing.weekdays],
      weekdaySeries: [{ label: m.evolution.views, data: margins.weekdays, tone: "--st-series-1" }],
      hourLabels: Array.from({ length: 24 }, (_, hour) => String(hour)),
      hourTooltips: Array.from({ length: 24 }, (_, hour) => hourLabel(hour)),
      hourSeries: [{ label: m.evolution.views, data: margins.hours, tone: "--st-series-1" }],
    };
  }, [heatmap, m, hourLabel]);
  let peak: { day: number; hour: number } | null = null;
  let peakViews = 0;
  for (let day = 0; day < heatmap.length; day += 1) {
    for (let hour = 0; hour < heatmap[day].length; hour += 1) {
      if (heatmap[day][hour] > peakViews) {
        peakViews = heatmap[day][hour];
        peak = { day, hour };
      }
    }
  }
  const shown: { day: number; hour: number } | null = hovered ?? peak;
  let readout = m.timing.peakNone;
  if (shown && hovered) {
    readout = fillTemplate(m.timing.cell, { day: m.timing.weekdays[shown.day], hour: shown.hour, views: f.number(heatmap[shown.day][shown.hour]) });
  } else if (shown) {
    readout = fillTemplate(m.timing.peak, { day: m.timing.weekdays[shown.day], hour: shown.hour });
  }
  const level = (views: number) => (views <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((views / max) * HEAT_LEVELS)));

  return (
    <>
      <div className={styles.heatmap} aria-hidden="true" onMouseLeave={() => onHover(null)}>
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className={styles.heatHour}>
            {hour % 3 === 0 ? hour : ""}
          </span>
        ))}
        {heatmap.map((row, day) => (
          <HeatRow key={day} label={m.timing.weekdaysShort[day]} row={row} day={day} level={level} onHover={onHover} />
        ))}
      </div>
      <div className={styles.heatFoot}>
        <p className={styles.readout} aria-live="polite">
          {readout}
        </p>
        <span className={styles.heatScale} aria-hidden="true">
          {m.timing.less}
          {Array.from({ length: HEAT_LEVELS + 1 }, (_, index) => (
            <span key={index} className={styles.heatCell} data-level={index} />
          ))}
          {m.timing.more}
        </span>
      </div>
      <div className={styles.margins}>
        <div>
          <h3 className={styles.shareTitle}>{m.timing.weekdaysTitle}</h3>
          <AudienceChart
            type="bar"
            labels={marginCharts.weekdayLabels}
            tooltipLabels={marginCharts.weekdayTooltips}
            series={marginCharts.weekdaySeries}
            ariaLabel={m.timing.weekdaysTitle}
            loadingLabel={m.chart.loading}
            tooltipTemplate={m.chart.tooltip}
            formatValue={formatNumber}
            height={200}
          />
        </div>
        <div>
          <h3 className={styles.shareTitle}>{m.timing.hoursTitle}</h3>
          <AudienceChart
            type="bar"
            labels={marginCharts.hourLabels}
            tooltipLabels={marginCharts.hourTooltips}
            series={marginCharts.hourSeries}
            ariaLabel={m.timing.hoursTitle}
            loadingLabel={m.chart.loading}
            tooltipTemplate={m.chart.tooltip}
            formatValue={formatNumber}
            height={200}
          />
        </div>
      </div>
      <DataTable
        m={m}
        caption={m.timing.heatmapTitle}
        columns={[m.timing.weekdaysTitle, ...Array.from({ length: 24 }, (_, hour) => hourLabel(hour))]}
        rows={heatmap.map((row, day) => [m.timing.weekdays[day], ...row.map((views) => f.number(views))])}
      />
    </>
  );
}

function HeatRow({
  label,
  row,
  day,
  level,
  onHover,
}: {
  label: string;
  row: number[];
  day: number;
  level: (views: number) => number;
  onHover: (cell: { day: number; hour: number }) => void;
}) {
  return (
    <>
      <span className={styles.heatDay}>{label}</span>
      {row.map((views, hour) => (
        <span key={hour} className={styles.heatCell} data-level={level(views)} onMouseEnter={() => onHover({ day, hour })} />
      ))}
    </>
  );
}

function Community({ m, community, f }: { m: AudienceMessages; community: NonNullable<AudienceStats["community"]>; f: Formatters }) {
  const items = [
    { key: "tournaments", label: m.community.tournaments, value: community.tournaments },
    { key: "matches", label: m.community.matches, value: community.matches },
    { key: "teams", label: m.community.teams, value: community.teams },
    { key: "players", label: m.community.players, value: community.players },
  ];
  return (
    <section className={styles.community} aria-labelledby="audience-community">
      <Titled hint={m.community.hint} subject={m.community.title}>
        <h2 id="audience-community" className={styles.cardTitle}>
          {m.community.title}
        </h2>
      </Titled>
      <dl className={styles.communityGrid}>
        {items.map((item) => (
          <div key={item.key} className={styles.communityItem}>
            <dt>{item.label}</dt>
            <dd>{f.number(item.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
