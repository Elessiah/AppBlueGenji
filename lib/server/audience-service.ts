/**
 * Statistiques de fréquentation détaillées — enregistrement, repli, lecture.
 *
 * Règles (`docs/features/AUDIENCE_MEASUREMENT.md`, registre T19) :
 *
 * - **Sel du jour, effacé une fois le jour replié.** {@link dailySalt} tire
 *   32 octets au hasard au premier signalement d'un jour (heure de Paris) et
 *   les garde dans `bg_audience_salts` : un redémarrage du site reprend le même
 *   sel, et un visiteur ne compte pas deux fois. Chaque page vue prend le sel
 *   de **son** jour (une page ouverte à 23 h 58 et reçue à 0 h 02 garde celui
 *   de la veille), et la suite d'une lecture celui du jour où sa page s'est
 *   ouverte. Le jour replié, son sel est effacé (base et mémoire de chaque
 *   processus, au plus {@link MAINTENANCE_INTERVAL_MS} ms plus tard) et ses
 *   entrées tardives sont écartées : une empreinte d'un jour passé ne se
 *   recalcule plus, même par l'association. L'entretien attend les
 *   signalements en cours avant de replier : aucun n'écrit dans un jour clos.
 * - **Aucune adresse IP gardée.** L'IP sert au HMAC, à l'instant, puis au seul
 *   plafond de débit (`AUDIENCE_REQUEST_RULE`, en mémoire, deux minutes au plus) ;
 *   la file d'écriture ne porte que l'empreinte.
 * - **Écritures groupées.** Les pages vues attendent en mémoire (au plus
 *   {@link FLUSH_DELAY_MS} ms ou {@link FLUSH_SIZE} lignes) puis partent en un
 *   seul `INSERT` : un signalement n'attend la base que pour lire le sel du
 *   jour, une fois par jour et par processus.
 * - **Repli** des jours révolus (une fois la marge {@link ROLLUP_GRACE_MINUTES}
 *   passée après minuit), effacement de leur sel, puis **purge** du détail
 *   au-delà de `AUDIENCE_RAW_RETENTION_MONTHS` mois ; entraînés par le trafic
 *   (au plus toutes les {@link MAINTENANCE_INTERVAL_MS} ms), sans ordonnanceur.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { failureReason } from "@/lib/server/failure-reason";
import { getDatabase } from "./database";
import { readSiteCounts } from "./site-counts";
import { inTransaction } from "./tournaments/transaction";
import { PLAYED_STATES } from "@/lib/shared/stats";
import {
  AUDIENCE_RANGES,
  AUDIENCE_RAW_RETENTION_MONTHS,
  aggregateAudienceDay,
  emptyHeatmap,
  parisClock,
  rangeStart,
  shiftDay,
  shiftMonths,
  type AudienceCommunity,
  type AudienceDailyPoint,
  type AudienceRange,
  type AudienceRangeStats,
  type AudienceRawRow,
  type AudienceShare,
  type AudienceStats,
  type AudienceView,
} from "@/lib/shared/audience";
import { visitorIdentitySource } from "@/lib/shared/site-visits";

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
/** Délai avant de relire un sel dont la lecture a échoué (base en panne). */
export const SALT_RETRY_MS = 30_000;
/** Une lecture de sel sans réponse passé ce délai échoue (puis {@link SALT_RETRY_MS}) : rien ne l'attend sans fin. */
export const SALT_READ_TIMEOUT_MS = 10_000;
/** L'entretien attend au plus ce délai les signalements en cours avant de replier. */
export const RECORDING_WAIT_MS = 15_000;
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

/** Sels lus ou tirés, par jour : la veille tant qu'elle n'est pas repliée, et le jour. */
const salts = new Map<string, Promise<Buffer>>();
/** Balayage des sels en mémoire, actif tant qu'il en reste : un processus sans trafic les oublie aussi. */
let saltSweep: ReturnType<typeof setInterval> | null = null;
/** Signalements en cours : l'entretien les attend avant de replier. */
const recording = new Set<Promise<number>>();
let pending: PendingRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
let lastMaintenanceAt = 0;
/**
 * Dernier jour que l'entretien de ce processus a commencé à replier : un
 * signalement qui finit après (attente de l'entretien dépassée) écarte ses
 * lignes de ces jours plutôt que de les écrire après leur repli.
 */
let rolledThrough: string | null = null;
let maintaining: Promise<void> | null = null;
let statsCache: { at: number; value: AudienceStats } | null = null;
let statsLoad: Promise<AudienceStats> | null = null;
/** Avancée à chaque repli : une lecture commencée avant n'est pas mise en cache. */
let statsGeneration = 0;

interface SaltRow extends RowDataPacket {
  salt: Buffer;
}

async function loadSalt(day: string): Promise<Buffer> {
  const db = await getDatabase();
  // Le premier signalement du jour tire le sel ; un signalement concurrent, ou
  // le site redémarré, relit celui qui est en base.
  await db.execute(`INSERT IGNORE INTO bg_audience_salts (day, salt) VALUES (?, ?)`, [day, randomBytes(32)]);
  const [rows] = await db.execute<SaltRow[]>(`SELECT salt FROM bg_audience_salts WHERE day = ?`, [day]);
  const value = rows[0]?.salt;
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new Error("audience salt unreadable");
  return value;
}

/**
 * Sel du jour `day` : tiré au hasard la première fois, gardé en base jusqu'au
 * repli du jour, puis effacé (voir {@link forgetSalts}).
 */
export function dailySalt(day: string): Promise<Buffer> {
  const known = salts.get(day);
  if (known) return known;
  const value = withTimeout(loadSalt(day), SALT_READ_TIMEOUT_MS, "audience salt read timed out");
  salts.set(day, value);
  startSaltSweep();
  // Une lecture ratée reste en échec SALT_RETRY_MS ms (une ligne au journal,
  // pas une requête par signalement), puis le signalement suivant réessaie.
  value.catch((error: unknown) => {
    console.error(`[audience] Sel du ${day} illisible : pages vues de ce jour écartées.`, failureReason(error));
    const retry = setTimeout(() => {
      if (salts.get(day) === value) salts.delete(day);
    }, SALT_RETRY_MS);
    retry.unref?.();
  });
  return value;
}

/** `promise`, ou un échec `message` passé `ms` ms. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Oublie en mémoire les sels des jours clos (`day <= until`). */
function dropClosedSalts(until: string): void {
  for (const day of [...salts.keys()]) if (day <= until) salts.delete(day);
  if (salts.size === 0 && saltSweep) {
    clearInterval(saltSweep);
    saltSweep = null;
  }
}

function startSaltSweep(): void {
  if (saltSweep) return;
  saltSweep = setInterval(() => dropClosedSalts(lastRollableDay(new Date())), MAINTENANCE_INTERVAL_MS);
  saltSweep.unref?.();
}

/** Empreinte d'un visiteur pour la journée : HMAC-SHA-256 de l'IP et du navigateur sous le sel du jour. */
export async function audienceVisitorKey(day: string, ip: string | null, userAgent: string | null): Promise<string> {
  const salt = await dailySalt(day);
  return createHmac("sha256", salt).update(visitorIdentitySource({ ip, userAgent })).digest("hex");
}

/** Efface les sels des jours repliés (`day <= until`), en base puis en mémoire. */
export async function forgetSalts(until: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM bg_audience_salts WHERE day <= ?`, [until]);
  dropClosedSalts(until);
}

/** `AAAA-MM-JJ HH:MM:SS` en temps universel, pour une colonne `DATETIME`. */
function utcDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Met en file des pages vues signalées par un navigateur. Les pages vues ne
 * sont pas écrites ici : l'écriture part groupée (voir
 * {@link flushAudienceViews}) ; seul le sel du jour peut être lu ou tiré.
 *
 * Une entrée d'un jour déjà repliable est écartée : elle ne serait jamais
 * comptée, et le sel de ce jour est effacé. Un jour dont le sel est illisible
 * perd ses seules entrées, pas celles des autres jours de l'envoi.
 *
 * @returns Le nombre de pages vues retenues.
 */
export function recordAudienceViews(input: AudienceRecordInput): Promise<number> {
  const job = recordViews(input);
  recording.add(job);
  const done = () => {
    recording.delete(job);
  };
  job.then(done, done);
  return job;
}

interface AudienceRecordInput {
  ip: string | null;
  userAgent: string | null;
  views: readonly AudienceView[];
  now?: Date;
}

async function recordViews(input: AudienceRecordInput): Promise<number> {
  const now = input.now ?? new Date();
  const closed = lastRollableDay(now);
  dropClosedSalts(closed);
  const rows: Omit<PendingRow, "visitorKey">[] = [];
  for (const view of input.views) {
    const viewedAt = new Date(now.getTime() - view.ageMs);
    // Le jour (et le sel) d'une suite est celui où sa page s'est ouverte.
    const clock = parisClock(new Date(now.getTime() - view.openedAgeMs));
    if (clock.day <= closed) continue;
    rows.push({ day: clock.day, hour: clock.hour, viewedAt: utcDateTime(viewedAt), view });
  }
  // Le sel est celui du jour de la page vue, pas celui du jour de réception.
  const days = [...new Set(rows.map((row) => row.day))];
  const settled = await Promise.allSettled(days.map((day) => audienceVisitorKey(day, input.ip, input.userAgent)));
  const keys = new Map<string, string>();
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") keys.set(days[index], result.value);
  });
  // L'entretien attend ce signalement avant de replier, puis vide la file : un
  // jour devenu clos pendant la lecture des sels est encore compté. Seul un
  // jour que l'entretien a déjà commencé à replier (attente dépassée) est écarté.
  let kept = 0;
  for (const row of rows) {
    const visitorKey = keys.get(row.day);
    if (!visitorKey || (rolledThrough !== null && row.day <= rolledThrough)) continue;
    if (pending.length >= MAX_PENDING) break;
    pending.push({ ...row, visitorKey });
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
 * Entretien entraîné par le trafic : repli des jours révolus, effacement de
 * leur sel, puis purge du détail trop ancien. Au plus une fois par
 * {@link MAINTENANCE_INTERVAL_MS} ; jamais attendu par l'appelant, jamais levé.
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

/** Repli, effacement des sels des jours repliés, puis purge (attendus : tests, et `maintainAudience`). */
export async function runMaintenance(now: Date = new Date()): Promise<void> {
  // Les signalements commencés avant l'entretien finissent, puis toute la file
  // part : rien d'un jour replié n'arrive après son repli. Ceux qui commencent
  // ensuite voient ce jour clos et l'écartent. L'attente est bornée : un
  // signalement qui la dépasse écarte ensuite ses lignes des jours repliés.
  await withTimeout(Promise.allSettled([...recording]), RECORDING_WAIT_MS, "audience recording wait timed out").catch(() => undefined);
  for (let pass = 0; pass < 3 && (flushing || pending.length > 0); pass += 1) {
    await flushAudienceViews();
  }
  const until = lastRollableDay(now);
  if (rolledThrough === null || until > rolledThrough) rolledThrough = until;
  const rolled = await rollUpAudienceDays(now);
  // Un jour clos n'a plus besoin de son sel : ses entrées tardives sont écartées.
  await forgetSalts(until);
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
  weekday: number | string;
  hour: number | string;
  views: number | string;
}

interface DimRow extends RowDataPacket {
  dim: string;
  dim_value: string;
  views: number | string;
  visitors: number | string;
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
  const [[pages], [hours], [dims]] = await Promise.all([
    db.execute<PageRow[]>(
      `SELECT page_key, SUM(views) AS views, SUM(visitors) AS visitors, SUM(engaged_ms) AS engaged_ms
         FROM bg_audience_day_pages ${where}
        GROUP BY page_key
        ORDER BY views DESC`,
      params,
    ),
    // Grille 7 × 24 faite par la base (`WEEKDAY` : lundi = 0) : 168 lignes au plus.
    db.execute<HourRow[]>(
      `SELECT WEEKDAY(day) AS weekday, hour, SUM(views) AS views
         FROM bg_audience_day_hours ${where}
        GROUP BY WEEKDAY(day), hour`,
      params,
    ),
    db.execute<DimRow[]>(
      `SELECT dim, dim_value, SUM(views) AS views, SUM(visitors) AS visitors
         FROM bg_audience_day_dims ${where}
        GROUP BY dim, dim_value`,
      params,
    ),
  ]);
  const heatmap = emptyHeatmap();
  for (const row of hours) {
    const weekday = Number(row.weekday);
    const hour = Number(row.hour);
    if (weekday >= 0 && weekday < 7 && hour >= 0 && hour < 24) heatmap[weekday][hour] += num(row.views);
  }
  return {
    pages: pages.map((row) => ({ key: row.page_key, views: num(row.views), visitors: num(row.visitors), engagedMs: num(row.engaged_ms) })),
    heatmap,
    devices: shares(dims, "device"),
    sources: shares(dims, "source"),
    locales: shares(dims, "locale"),
  };
}

interface CommunityRow extends RowDataPacket {
  matches: number | string;
  tournaments: number | string;
}

/** États « joué » de `stats.ts`, en littéraux SQL (constantes du code, jamais une saisie). */
const PLAYED_STATES_SQL = [...PLAYED_STATES].map((state) => `'${state}'`).join(", ");

/**
 * Chiffres publics de la communauté, sans aucune donnée d'une personne :
 * tournois publiés joués (en cours ou terminés, comme les fiches d'équipe et
 * les profils : `PLAYED_STATES`), matchs joués de ces tournois publiés,
 * équipes de l'annuaire et comptes du site — ces deux derniers lus par
 * `site-counts.ts`, comme l'accueil. `null` si la lecture échoue.
 */
async function readCommunity(): Promise<AudienceCommunity | null> {
  try {
    const db = await getDatabase();
    const [[played], site] = await Promise.all([
      db
        .execute<CommunityRow[]>(
          `SELECT
             (SELECT COUNT(*) FROM bg_matches m
                JOIN bg_tournaments t ON t.id = m.tournament_id
               WHERE m.status = 'COMPLETED' AND m.is_bye = FALSE AND t.start_visibility_at <= NOW()) AS matches,
             (SELECT COUNT(*) FROM bg_tournaments
               WHERE state IN (${PLAYED_STATES_SQL}) AND start_visibility_at <= NOW()) AS tournaments`,
        )
        .then(([rows]) => rows),
      readSiteCounts(),
    ]);
    return { tournaments: num(played?.tournaments), matches: num(played?.matches), teams: site.teams, players: site.players };
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
  // Les quatre périodes et la communauté, lues en parallèle.
  const [community, ranges] = await Promise.all([
    readCommunity(),
    Promise.all(AUDIENCE_RANGES.map((range) => readRange(lastDay ? rangeStart(range, lastDay) : null))),
  ]);
  return {
    lastDay,
    firstDay,
    daily: points,
    ranges: Object.fromEntries(AUDIENCE_RANGES.map((range, index) => [range, ranges[index]])) as Record<AudienceRange, AudienceRangeStats>,
    community,
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
  salts.clear();
  if (saltSweep) clearInterval(saltSweep);
  saltSweep = null;
  recording.clear();
  pending = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  flushing = null;
  lastMaintenanceAt = 0;
  rolledThrough = null;
  maintaining = null;
  statsCache = null;
  statsLoad = null;
  statsGeneration = 0;
}

/** File en attente d'écriture (tests). */
export function pendingAudienceCount(): number {
  return pending.length;
}
