/**
 * Statistiques de fréquentation détaillées — enregistrement, repli, lecture.
 *
 * Règles (`docs/features/AUDIENCE_MEASUREMENT.md`, registre T19) :
 *
 * - **Sel du jour, en mémoire seulement.** {@link dailySalt} tire 32 octets au
 *   hasard au premier signalement d'un jour (heure de Paris) et les remplace au
 *   jour suivant : l'ancien sel n'est écrit nulle part, si bien qu'une empreinte
 *   d'hier ne se recalcule plus, même par l'association. Un redémarrage tire un
 *   sel neuf : un visiteur de ce jour peut alors compter deux fois.
 * - **Aucune adresse IP gardée.** L'IP sert au HMAC, à l'instant, puis au seul
 *   plafond de débit (`AUDIENCE_REQUEST_RULE`, en mémoire, deux minutes au plus) ;
 *   la file d'écriture ne porte que l'empreinte.
 * - **Écritures groupées.** Les pages vues attendent en mémoire (au plus
 *   {@link FLUSH_DELAY_MS} ms ou {@link FLUSH_SIZE} lignes) puis partent en un
 *   seul `INSERT` : un signalement ne fait jamais attendre la base.
 * - **Repli** des jours révolus (une fois la marge {@link ROLLUP_GRACE_MINUTES}
 *   passée après minuit), puis **purge** du détail au-delà de
 *   `AUDIENCE_RAW_RETENTION_MONTHS` mois ; entraînés par le trafic (au plus
 *   toutes les {@link MAINTENANCE_INTERVAL_MS} ms), sans ordonnanceur.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { failureReason } from "@/lib/server/failure-reason";
import { getDatabase } from "./database";
import { inTransaction } from "./tournaments/transaction";
import {
  AUDIENCE_RANGES,
  AUDIENCE_RAW_RETENTION_MONTHS,
  aggregateAudienceDay,
  emptyHeatmap,
  parisClock,
  rangeStart,
  shiftDay,
  shiftMonths,
  weekdayIndex,
  type AudienceCommunity,
  type AudienceDailyPoint,
  type AudienceRange,
  type AudienceRangeStats,
  type AudienceRawRow,
  type AudienceShare,
  type AudienceStats,
  type AudienceView,
} from "@/lib/shared/audience";

/** Délai maximal d'attente d'une page vue en mémoire avant écriture. */
export const FLUSH_DELAY_MS = 10_000;
/** Taille de file qui déclenche l'écriture sans attendre. */
export const FLUSH_SIZE = 200;
/** Au-delà, les pages vues reçues sont écartées (base en panne). */
export const MAX_PENDING = 5_000;
/** Marge après minuit avant de replier la veille (les pages signalées en différé). */
export const ROLLUP_GRACE_MINUTES = 75;
/** Cadence de l'entretien (repli et purge). */
export const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;
/** Durée de vie de la lecture mise en cache pour la page. */
export const STATS_CACHE_MS = 10 * 60 * 1000;
/** Lignes effacées par passe de purge. */
const PURGE_BATCH = 10_000;
/** Jours repliés au plus par entretien (rattrapage progressif). */
const ROLLUP_MAX_DAYS = 31;

interface PendingRow {
  day: string;
  hour: number;
  viewedAt: string;
  visitorKey: string;
  view: AudienceView;
}

let salt: { day: string; value: Buffer } | null = null;
let pending: PendingRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
let lastMaintenanceAt = 0;
let maintaining: Promise<void> | null = null;
let statsCache: { at: number; value: AudienceStats } | null = null;
let statsLoad: Promise<AudienceStats> | null = null;
/** Avancée à chaque repli : une lecture commencée avant n'est pas mise en cache. */
let statsGeneration = 0;

/**
 * Sel du jour `day` : tiré au hasard la première fois, remplacé (et l'ancien
 * oublié) dès qu'un autre jour est demandé.
 */
export function dailySalt(day: string): Buffer {
  if (salt?.day !== day) salt = { day, value: randomBytes(32) };
  return salt.value;
}

/** Empreinte d'un visiteur pour la journée : HMAC-SHA-256 de l'IP et du navigateur sous le sel du jour. */
export function audienceVisitorKey(day: string, ip: string | null, userAgent: string | null): string {
  const source = `${(ip ?? "").trim() || "unknown-ip"}|${(userAgent ?? "").trim() || "unknown-ua"}`;
  return createHmac("sha256", dailySalt(day)).update(source).digest("hex");
}

/** `AAAA-MM-JJ HH:MM:SS` en temps universel, pour une colonne `DATETIME`. */
function utcDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Met en file des pages vues signalées par un navigateur. Ne touche pas la
 * base : l'écriture part groupée (voir {@link flushAudienceViews}).
 *
 * Une page vue datée d'un jour antérieur à la veille est écartée (elle
 * arriverait après le repli de son jour).
 *
 * @returns Le nombre de pages vues retenues.
 */
export function recordAudienceViews(input: {
  ip: string | null;
  userAgent: string | null;
  views: readonly AudienceView[];
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const today = parisClock(now).day;
  const oldest = shiftDay(today, -1);
  let kept = 0;
  for (const view of input.views) {
    if (pending.length >= MAX_PENDING) break;
    const viewedAt = new Date(now.getTime() - view.ageMs);
    const clock = parisClock(viewedAt);
    if (clock.day < oldest) continue;
    pending.push({
      day: clock.day,
      hour: clock.hour,
      viewedAt: utcDateTime(viewedAt),
      // Le sel est celui du jour de **réception** : une page vue juste avant
      // minuit et reçue juste après prend l'empreinte du nouveau jour.
      visitorKey: audienceVisitorKey(today, input.ip, input.userAgent),
      view,
    });
    kept += 1;
  }
  if (pending.length >= FLUSH_SIZE) void flushAudienceViews();
  else if (pending.length > 0) scheduleFlush();
  return kept;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAudienceViews();
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

/** Écrit la file en un seul `INSERT`. Un échec perd ce lot (mesure d'agrément), jamais plus. */
export function flushAudienceViews(): Promise<void> {
  if (flushing) return flushing;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = pending;
  pending = [];
  if (batch.length === 0) return Promise.resolve();
  flushing = writeBatch(batch)
    .catch((error: unknown) => {
      console.error(`[audience] ${batch.length} page(s) vue(s) non enregistrée(s).`, failureReason(error));
    })
    .finally(() => {
      flushing = null;
      if (pending.length > 0) scheduleFlush();
    });
  return flushing;
}

async function writeBatch(batch: readonly PendingRow[]): Promise<void> {
  const db = await getDatabase();
  const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const values = batch.flatMap((row) => [
    row.day,
    row.hour,
    row.viewedAt,
    row.visitorKey,
    row.view.pageKey,
    row.view.locale,
    row.view.device,
    row.view.source,
    row.view.isView ? 1 : 0,
    row.view.engagedMs,
  ]);
  await db.execute(
    `INSERT INTO bg_audience_views
       (day, hour, viewed_at, visitor_key, page_key, locale, device, source, is_view, engaged_ms)
     VALUES ${placeholders}`,
    values,
  );
}

/** Dernier jour qu'on peut replier à cet instant (inclus). */
export function lastRollableDay(now: Date): string {
  const clock = parisClock(now);
  const pastGrace = clock.hour * 60 + clock.minute >= ROLLUP_GRACE_MINUTES;
  return shiftDay(clock.day, pastGrace ? -1 : -2);
}

/** Premier jour encore gardé au détail : les jours d'avant sont purgés. */
export function rawRetentionStart(now: Date): string {
  return shiftMonths(parisClock(now).day, -AUDIENCE_RAW_RETENTION_MONTHS);
}

/**
 * Entretien entraîné par le trafic : repli des jours révolus, puis purge du
 * détail trop ancien. Au plus une fois par {@link MAINTENANCE_INTERVAL_MS} ;
 * jamais attendu par l'appelant, jamais levé.
 */
export function maintainAudience(now: Date = new Date()): void {
  if (now.getTime() - lastMaintenanceAt < MAINTENANCE_INTERVAL_MS || maintaining) return;
  lastMaintenanceAt = now.getTime();
  maintaining = runMaintenance(now)
    .catch((error: unknown) => {
      console.error("[audience] Entretien (repli, purge) impossible.", failureReason(error));
    })
    .finally(() => {
      maintaining = null;
    });
}

/** Repli puis purge, attendus (tests, et `maintainAudience`). */
export async function runMaintenance(now: Date = new Date()): Promise<void> {
  await flushAudienceViews();
  const rolled = await rollUpAudienceDays(now);
  await purgeAudienceViews(now);
  if (rolled > 0) {
    statsCache = null;
    statsGeneration += 1;
  }
}

interface DayRow extends RowDataPacket {
  day: string;
}

/**
 * Replie, dans l'ordre, les jours du détail postérieurs au dernier jour replié
 * et antérieurs ou égaux à {@link lastRollableDay}. Chaque jour en une
 * transaction : compteurs effacés puis réécrits (rejouable), la ligne de
 * `bg_audience_days` en dernier.
 *
 * @returns Le nombre de jours repliés.
 */
export async function rollUpAudienceDays(now: Date = new Date()): Promise<number> {
  const db = await getDatabase();
  const until = lastRollableDay(now);
  const [days] = await db.execute<DayRow[]>(
    `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day
       FROM bg_audience_views
      WHERE day <= ?
        AND day > (SELECT COALESCE(MAX(d.day), '1000-01-01') FROM bg_audience_days d)
      GROUP BY day
      ORDER BY day
      LIMIT ${ROLLUP_MAX_DAYS}`,
    [until],
  );
  for (const { day } of days) {
    await inTransaction((connection) => rollUpDay(connection, day));
  }
  return days.length;
}

interface RawRow extends RowDataPacket {
  viewed_at: string;
  hour: number;
  visitor_key: string;
  page_key: string;
  locale: string;
  device: string;
  source: string;
  is_view: number;
  engaged_ms: number;
}

async function rollUpDay(connection: PoolConnection, day: string): Promise<void> {
  const [rows] = await connection.execute<RawRow[]>(
    `SELECT viewed_at, hour, visitor_key, page_key, locale, device, source, is_view, engaged_ms
       FROM bg_audience_views
      WHERE day = ?
      ORDER BY viewed_at, id`,
    [day],
  );
  const aggregate = aggregateAudienceDay(
    rows.map<AudienceRawRow>((row) => ({
      viewedAt: new Date(`${String(row.viewed_at).replace(" ", "T")}Z`),
      hour: Number(row.hour),
      visitorKey: row.visitor_key,
      pageKey: row.page_key,
      locale: row.locale,
      device: row.device,
      source: row.source,
      isView: Number(row.is_view) === 1,
      engagedMs: Number(row.engaged_ms),
    })),
  );
  for (const table of ["bg_audience_day_pages", "bg_audience_day_hours", "bg_audience_day_dims", "bg_audience_days"]) {
    await connection.execute(`DELETE FROM ${table} WHERE day = ?`, [day]);
  }
  if (aggregate.pages.length > 0) {
    await connection.execute(
      `INSERT INTO bg_audience_day_pages (day, page_key, views, visitors, engaged_ms) VALUES ${aggregate.pages.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
      aggregate.pages.flatMap((page) => [day, page.pageKey, page.views, page.visitors, page.engagedMs]),
    );
  }
  if (aggregate.hours.length > 0) {
    await connection.execute(
      `INSERT INTO bg_audience_day_hours (day, hour, views, visitors) VALUES ${aggregate.hours.map(() => "(?, ?, ?, ?)").join(", ")}`,
      aggregate.hours.flatMap((hour) => [day, hour.hour, hour.views, hour.visitors]),
    );
  }
  if (aggregate.dims.length > 0) {
    await connection.execute(
      `INSERT INTO bg_audience_day_dims (day, dim, dim_value, views, visitors) VALUES ${aggregate.dims.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
      aggregate.dims.flatMap((dim) => [day, dim.dim, dim.value, dim.views, dim.visitors]),
    );
  }
  const { totals } = aggregate;
  await connection.execute(
    `INSERT INTO bg_audience_days (day, views, visitors, visits, bounces, engaged_ms) VALUES (?, ?, ?, ?, ?, ?)`,
    [day, totals.views, totals.visitors, totals.visits, totals.bounces, totals.engagedMs],
  );
}

/**
 * Efface le détail antérieur à {@link rawRetentionStart}, par passes bornées.
 * Les compteurs repliés restent.
 *
 * @returns Le nombre de lignes effacées.
 */
export async function purgeAudienceViews(now: Date = new Date()): Promise<number> {
  const db = await getDatabase();
  const cutoff = rawRetentionStart(now);
  let total = 0;
  for (;;) {
    const [result] = await db.execute<ResultSetHeader>(
      `DELETE FROM bg_audience_views WHERE day < ? LIMIT ${PURGE_BATCH}`,
      [cutoff],
    );
    total += result.affectedRows;
    if (result.affectedRows < PURGE_BATCH) return total;
  }
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

interface DailyRow extends RowDataPacket {
  day: string;
  views: number | string;
  visitors: number | string;
  visits: number | string;
  bounces: number | string;
  engaged_ms: number | string;
}

interface PageRow extends RowDataPacket {
  page_key: string;
  views: number | string;
  visitors: number | string;
  engaged_ms: number | string;
}

interface HourRow extends RowDataPacket {
  day: string;
  hour: number;
  views: number | string;
}

interface DimRow extends RowDataPacket {
  dim: string;
  dim_value: string;
  views: number | string;
  visitors: number | string;
}

interface CountRow extends RowDataPacket {
  n: number | string;
}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function shares(rows: readonly DimRow[], dim: string): AudienceShare[] {
  return rows
    .filter((row) => row.dim === dim)
    .map((row) => ({ key: row.dim_value, views: num(row.views), visitors: num(row.visitors) }))
    .sort((a, b) => b.views - a.views);
}

async function readRange(from: string | null): Promise<AudienceRangeStats> {
  const db = await getDatabase();
  const where = from ? "WHERE day >= ?" : "";
  const params = from ? [from] : [];
  const [pages] = await db.execute<PageRow[]>(
    `SELECT page_key, SUM(views) AS views, SUM(visitors) AS visitors, SUM(engaged_ms) AS engaged_ms
       FROM bg_audience_day_pages ${where}
      GROUP BY page_key
      ORDER BY views DESC`,
    params,
  );
  const [hours] = await db.execute<HourRow[]>(
    `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, hour, views FROM bg_audience_day_hours ${where}`,
    params,
  );
  const [dims] = await db.execute<DimRow[]>(
    `SELECT dim, dim_value, SUM(views) AS views, SUM(visitors) AS visitors
       FROM bg_audience_day_dims ${where}
      GROUP BY dim, dim_value`,
    params,
  );
  const heatmap = emptyHeatmap();
  for (const row of hours) {
    const hour = Number(row.hour);
    if (hour >= 0 && hour < 24) heatmap[weekdayIndex(row.day)][hour] += num(row.views);
  }
  return {
    pages: pages.map((row) => ({ key: row.page_key, views: num(row.views), visitors: num(row.visitors), engagedMs: num(row.engaged_ms) })),
    heatmap,
    devices: shares(dims, "device"),
    sources: shares(dims, "source"),
    locales: shares(dims, "locale"),
  };
}

/**
 * Chiffres publics de la communauté, sans aucune donnée d'une personne :
 * tournois publiés terminés, matchs joués, équipes actives (ni entrée solo,
 * ni fantôme), comptes actifs. `null` si la lecture échoue.
 */
async function readCommunity(): Promise<AudienceCommunity | null> {
  try {
    const db = await getDatabase();
    const count = async (sql: string) => {
      const [rows] = await db.execute<CountRow[]>(sql);
      return num(rows[0]?.n);
    };
    const [tournaments, matches, teams, players] = await Promise.all([
      count(`SELECT COUNT(*) AS n FROM bg_tournaments WHERE state = 'FINISHED' AND start_visibility_at <= NOW()`),
      count(
        `SELECT COUNT(*) AS n FROM bg_matches m
           JOIN bg_tournaments t ON t.id = m.tournament_id
          WHERE m.status = 'COMPLETED' AND m.is_bye = FALSE AND t.start_visibility_at <= NOW()`,
      ),
      count(`SELECT COUNT(*) AS n FROM bg_teams WHERE solo_user_id IS NULL AND is_ghost = 0 AND deleted_at IS NULL`),
      count(`SELECT COUNT(*) AS n FROM bg_users WHERE is_deleted = 0`),
    ]);
    return { tournaments, matches, teams, players };
  } catch (error) {
    console.error("[audience] Chiffres de la communauté illisibles.", failureReason(error));
    return null;
  }
}

async function loadStats(): Promise<AudienceStats> {
  const db = await getDatabase();
  const [daily] = await db.execute<DailyRow[]>(
    `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, views, visitors, visits, bounces, engaged_ms
       FROM bg_audience_days
      ORDER BY day`,
  );
  const points: AudienceDailyPoint[] = daily.map((row) => ({
    day: row.day,
    views: num(row.views),
    visitors: num(row.visitors),
    visits: num(row.visits),
    bounces: num(row.bounces),
    engagedMs: num(row.engaged_ms),
  }));
  const lastDay = points.at(-1)?.day ?? null;
  const firstDay = points[0]?.day ?? null;
  const entries: [AudienceRange, AudienceRangeStats][] = [];
  for (const range of AUDIENCE_RANGES) {
    entries.push([range, await readRange(lastDay ? rangeStart(range, lastDay) : null)]);
  }
  return {
    lastDay,
    firstDay,
    daily: points,
    ranges: Object.fromEntries(entries) as Record<AudienceRange, AudienceRangeStats>,
    community: await readCommunity(),
  };
}

/**
 * Statistiques servies à la page, mises en cache {@link STATS_CACHE_MS} ms et
 * lues une seule fois à la fois. Relance l'entretien au passage.
 */
export async function getAudienceStats(now: Date = new Date()): Promise<AudienceStats> {
  maintainAudience(now);
  // Un repli en cours change ce qu'on lirait : il est attendu (il ne lève jamais).
  if (maintaining) await maintaining;
  if (statsCache && now.getTime() - statsCache.at < STATS_CACHE_MS) return statsCache.value;
  if (!statsLoad) {
    const generation = statsGeneration;
    statsLoad = loadStats()
      .then((value) => {
        // Un repli survenu pendant la lecture la rend périmée : servie, pas gardée.
        if (generation === statsGeneration) statsCache = { at: now.getTime(), value };
        return value;
      })
      .finally(() => {
        statsLoad = null;
      });
  }
  return statsLoad;
}

/** Remet l'état du module à zéro (tests). */
export function resetAudienceState(): void {
  salt = null;
  pending = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  flushing = null;
  lastMaintenanceAt = 0;
  maintaining = null;
  statsCache = null;
  statsLoad = null;
  statsGeneration = 0;
}

/** File en attente d'écriture (tests). */
export function pendingAudienceCount(): number {
  return pending.length;
}
