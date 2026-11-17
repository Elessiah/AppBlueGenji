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
 *   processus, une dizaine de minutes plus tard au plus) et ses
 *   entrées tardives sont écartées : une empreinte d'un jour passé ne se
 *   recalcule plus, même par l'association. L'entretien attend les
 *   signalements en cours avant de replier : aucun n'écrit dans un jour clos.
 * - **Aucune adresse IP gardée.** L'IP sert au HMAC, à l'instant, puis au seul
 *   plafonds de débit (`throttleAudienceRequest`, `admitAudienceViews`, en mémoire, deux minutes au plus) ;
 *   la file d'écriture ne porte que l'empreinte.
 * - **Écritures groupées.** Les pages vues attendent en mémoire (au plus
 *   {@link FLUSH_DELAY_MS} ms ou {@link FLUSH_SIZE} lignes) puis partent en un
 *   seul `INSERT` : un signalement n'attend la base que pour lire le sel du
 *   jour, une fois par jour et par processus.
 * - **Repli** des jours révolus (une fois la marge {@link ROLLUP_GRACE_MINUTES}
 *   passée après minuit), effacement de leur sel, puis **purge** du détail
 *   au-delà de `AUDIENCE_RAW_RETENTION_MONTHS` mois ; entraînés par le trafic
 *   (au plus toutes les {@link MAINTENANCE_INTERVAL_MS} ms), la page et
 *   l'horloge du serveur ({@link startAudienceMaintenanceClock}).
 */
import { createHmac, randomBytes } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { clientNetworkKey } from "@/lib/server/api-guard";
import { failureReason } from "@/lib/server/failure-reason";
import { getDatabase } from "./database";
import { readSiteCounts } from "./site-counts";
import { inTransaction } from "./tournaments/transaction";
import { PLAYED_STATES } from "@/lib/shared/stats";
import {
  AUDIENCE_RANGES,
  AUDIENCE_RAW_RETENTION_MONTHS,
  aggregateAudienceDay,
  anonymizeAudienceDay,
  type AudienceDistinctCounter,
  emptyHeatmap,
  inMemoryDistinctCounter,
  mergeAudienceAggregates,
  parisClock,
  publicPageStats,
  rangeStart,
  shiftDay,
  shiftMonths,
  type AudienceCommunity,
  type AudienceDayAggregate,
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
/**
 * Au-delà, les pages vues reçues sont écartées (base en panne) ; passé la
 * moitié, chaque envoi n'en ajoute plus qu'une.
 */
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
/**
 * L'entretien attend au plus ce délai les signalements en cours avant de
 * replier : la lecture de sel la plus longue ({@link SALT_READ_TIMEOUT_MS}) et
 * une marge, pour qu'un signalement en cours finisse avant le repli.
 */
export const RECORDING_WAIT_MS = SALT_READ_TIMEOUT_MS + 5_000;
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

/**
 * État de la mesure dans ce processus. Il vit sur `globalThis`, pas dans ce
 * module : Next charge le module en deux copies (routes, `instrumentation.ts`),
 * et l'horloge d'entretien doit voir la même file, les mêmes signalements en
 * cours, le même jour replié et le même cache que les routes — sans quoi elle
 * replierait un jour sans attendre ni vider leurs pages vues.
 */
interface AudienceState {
  /** Sels lus ou tirés, par jour : la veille tant qu'elle n'est pas repliée, et le jour. */
  salts: Map<string, Promise<Buffer>>;
  /** Balayage des sels en mémoire, actif tant qu'il en reste : un processus sans trafic les oublie aussi. */
  saltSweep: ReturnType<typeof setInterval> | null;
  /** Signalements en cours : l'entretien les attend avant de replier. */
  recording: Set<Promise<number>>;
  pending: PendingRow[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void> | null;
  lastMaintenanceAt: number;
  /**
   * Dernier jour que l'entretien de ce processus a commencé à replier : un
   * signalement qui finit après (attente de l'entretien dépassée) écarte ses
   * lignes de ces jours plutôt que de les écrire après leur repli.
   */
  rolledThrough: string | null;
  maintaining: Promise<void> | null;
  /** Horloge d'entretien ({@link startAudienceMaintenanceClock}), une par processus. */
  maintenanceClock: ReturnType<typeof setInterval> | null;
  /** Étapes de l'entretien en échec : une panne se journalise une fois, pas à chaque passage. */
  failing: Set<MaintenanceStep>;
  statsCache: { at: number; value: AudienceStats } | null;
  statsLoad: Promise<AudienceStats> | null;
  /** Avancée à chaque repli : une lecture commencée avant n'est pas mise en cache. */
  statsGeneration: number;
}

type MaintenanceStep = "rollup" | "salts" | "purge";

const audienceGlobal = globalThis as typeof globalThis & { __bgAudienceState?: AudienceState };

function freshState(): AudienceState {
  return {
    salts: new Map(),
    saltSweep: null,
    recording: new Set(),
    pending: [],
    flushTimer: null,
    flushing: null,
    lastMaintenanceAt: 0,
    rolledThrough: null,
    maintaining: null,
    maintenanceClock: null,
    failing: new Set(),
    statsCache: null,
    statsLoad: null,
    statsGeneration: 0,
  };
}

audienceGlobal.__bgAudienceState ??= freshState();
/** État partagé par toutes les copies du module (voir {@link AudienceState}). */
const S: AudienceState = audienceGlobal.__bgAudienceState;

interface SaltRow extends RowDataPacket {
  salt: Buffer;
}

async function loadSalt(day: string, clock: () => Date): Promise<Buffer> {
  const db = await getDatabase();
  // Le premier signalement du jour tire le sel ; un signalement concurrent, ou
  // le site redémarré, relit celui qui est en base. Jamais pour un jour déjà
  // replié (une lecture lente qui finit après l'entretien, ou un autre
  // processus) ni pour un jour clos (repli raté) : son sel est effacé et doit
  // le rester — un sel neuf ferait de ses visiteurs tardifs des visiteurs de plus.
  if (day > lastRollableDay(clock())) await db.execute(
    `INSERT IGNORE INTO bg_audience_salts (day, salt)
       SELECT ?, ? FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM bg_audience_days WHERE day >= ?)`,
    [day, randomBytes(32), day],
  );
  const [rows] = await db.execute<SaltRow[]>(`SELECT salt FROM bg_audience_salts WHERE day = ?`, [day]);
  const value = rows[0]?.salt;
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new Error("audience salt unreadable");
  return value;
}

/**
 * Sel du jour `day` : tiré au hasard la première fois, gardé en base jusqu'au
 * repli du jour, puis effacé (voir {@link forgetSalts}).
 *
 * @param now Instant du signalement ; l'horloge de la lecture en part et
 * avance avec le temps écoulé depuis l'appel.
 */
export function dailySalt(day: string, now: Date = new Date()): Promise<Buffer> {
  const known = S.salts.get(day);
  if (known) return known;
  const started = Date.now();
  const clock = () => new Date(now.getTime() + Math.max(0, Date.now() - started));
  const load = loadSalt(day, clock);
  // Une lecture abandonnée (délai dépassé) peut encore écrire le sel après
  // l'entretien qui l'a effacé : celui d'un jour clos à sa fin est effacé aussitôt.
  load.then(
    () => forgetSaltIfClosed(day, clock()),
    () => undefined,
  );
  const value = withTimeout(load, SALT_READ_TIMEOUT_MS, "audience salt read timed out");
  S.salts.set(day, value);
  startSaltSweep();
  // Une lecture ratée reste en échec SALT_RETRY_MS ms (une ligne au journal,
  // pas une requête par signalement), puis le signalement suivant réessaie.
  value.catch((error: unknown) => {
    console.error(`[audience] Sel du ${day} illisible : pages vues de ce jour écartées.`, failureReason(error));
    const retry = setTimeout(() => {
      if (S.salts.get(day) === value) S.salts.delete(day);
    }, SALT_RETRY_MS);
    retry.unref?.();
  });
  return value;
}

/**
 * Efface les sels des jours clos à `at` ({@link forgetSalts}) si `day` en
 * est : rattrape une écriture de sel finie après l'entretien. Jamais levé
 * (une erreur est journalisée).
 */
async function forgetSaltIfClosed(day: string, at: Date): Promise<void> {
  const closed = lastRollableDay(at);
  if (day > closed) return;
  try {
    await forgetSalts(closed);
  } catch (error) {
    console.error(`[audience] Sel du ${day} (jour clos) non effacé.`, failureReason(error));
  }
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
  // Supprimer pendant le parcours d'une `Map` est permis : pas de copie des clés.
  for (const day of S.salts.keys()) if (day <= until) S.salts.delete(day);
  if (S.salts.size === 0 && S.saltSweep) {
    clearInterval(S.saltSweep);
    S.saltSweep = null;
  }
}

function startSaltSweep(): void {
  if (S.saltSweep) return;
  S.saltSweep = setInterval(() => dropClosedSalts(lastRollableDay(new Date())), MAINTENANCE_INTERVAL_MS);
  S.saltSweep.unref?.();
}

/**
 * Empreinte d'un visiteur pour la journée : HMAC-SHA-256 du réseau et du
 * navigateur sous le sel du jour. Le réseau est l'adresse IPv4, ou le `/64`
 * d'une adresse IPv6 (`clientNetworkKey`, port et écritures variantes ôtés) :
 * tirer une adresse neuve dans son `/64` ne fait pas un visiteur de plus, et
 * les appareils d'un même navigateur derrière un `/64` comptent pour un, comme
 * derrière une adresse IPv4 partagée.
 */
export async function audienceVisitorKey(day: string, ip: string | null, userAgent: string | null, now: Date = new Date()): Promise<string> {
  const salt = await dailySalt(day, now);
  return createHmac("sha256", salt).update(visitorIdentitySource({ ip: clientNetworkKey(ip) ?? ip, userAgent })).digest("hex");
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
  S.recording.add(job);
  const done = () => {
    S.recording.delete(job);
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
  const settled = await Promise.allSettled(days.map((day) => audienceVisitorKey(day, input.ip, input.userAgent, now)));
  const keys = new Map<string, string>();
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") keys.set(days[index], result.value);
  });
  // L'entretien attend ce signalement avant de replier, puis vide la file : un
  // jour devenu clos pendant la lecture des sels est encore compté. Seul un
  // jour que l'entretien a déjà commencé à replier (attente dépassée) est écarté.
  // File à moitié pleine (base lente, rafale d'un client) : chaque envoi n'y
  // ajoute plus qu'une ligne, pour qu'un seul client ne prenne pas toute la
  // place restante aux autres visiteurs.
  const room = S.pending.length >= MAX_PENDING / 2 ? 1 : rows.length;
  let kept = 0;
  for (const row of rows) {
    const visitorKey = keys.get(row.day);
    if (!visitorKey || (S.rolledThrough !== null && row.day <= S.rolledThrough)) continue;
    if (S.pending.length >= MAX_PENDING || kept >= room) break;
    S.pending.push({ ...row, visitorKey });
    kept += 1;
  }
  if (S.pending.length >= FLUSH_SIZE) void flushAudienceViews();
  else if (S.pending.length > 0) scheduleFlush();
  return kept;
}

function scheduleFlush(): void {
  if (S.flushTimer) return;
  S.flushTimer = setTimeout(() => {
    S.flushTimer = null;
    void flushAudienceViews();
  }, FLUSH_DELAY_MS);
  S.flushTimer.unref?.();
}

/** Écrit la file par `INSERT` groupés. Un échec perd ce lot (mesure d'agrément), jamais plus. */
export function flushAudienceViews(now: Date = new Date()): Promise<void> {
  if (S.flushing) return S.flushing;
  if (S.flushTimer) {
    clearTimeout(S.flushTimer);
    S.flushTimer = null;
  }
  const batch = S.pending;
  S.pending = [];
  if (batch.length === 0) return Promise.resolve();
  S.flushing = writeBatch(batch, now)
    .catch((error: unknown) => {
      console.error(`[audience] ${batch.length} page(s) vue(s) non enregistrée(s).`, failureReason(error));
    })
    .finally(() => {
      S.flushing = null;
      // Une file déjà au seuil pendant l'écriture repart tout de suite : sans
      // cela, une rafale attendrait le minuteur et gonflerait vers `MAX_PENDING`.
      if (S.pending.length >= FLUSH_SIZE) void flushAudienceViews();
      else if (S.pending.length > 0) scheduleFlush();
    });
  return S.flushing;
}

interface LastDayRow extends RowDataPacket {
  day: string | null;
}

/** Lignes par `INSERT` : une rafale ne fait pas une requête de plusieurs Mo. */
export const INSERT_CHUNK = 1_000;

async function writeBatch(all: readonly PendingRow[], now: Date): Promise<void> {
  const db = await getDatabase();
  // Un jour déjà replié (par ce processus ou un autre) ne reçoit plus rien :
  // ses lignes ne seraient jamais comptées (le repli ne reprend que les jours
  // postérieurs au dernier replié). Le dernier jour replié ne se relit que si
  // une ligne est d'un jour repliable : un autre processus a pu le replier ;
  // sinon aucun repli n'a pu l'atteindre, et la requête est épargnée.
  let batch = all;
  const rollable = lastRollableDay(now);
  if (all.some((row) => row.day <= rollable)) {
    const [last] = await db.execute<LastDayRow[]>(`SELECT DATE_FORMAT(MAX(day), '%Y-%m-%d') AS day FROM bg_audience_days`);
    const lastRolled = last[0]?.day ?? null;
    if (lastRolled) batch = all.filter((row) => row.day > lastRolled);
  }
  for (let from = 0; from < batch.length; from += INSERT_CHUNK) {
    const chunk = batch.slice(from, from + INSERT_CHUNK);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = chunk.flatMap((row) => [
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
 * Entretien : repli des jours révolus, effacement de leur sel, puis purge du
 * détail trop ancien. Entraîné par le trafic mesuré, la page de fréquentation
 * et l'horloge du serveur ({@link startAudienceMaintenanceClock}). Au plus une
 * fois par {@link MAINTENANCE_INTERVAL_MS} ; jamais attendu par l'appelant,
 * jamais levé (chaque étape journalise elle-même son échec, voir
 * {@link runMaintenance}).
 */
export function maintainAudience(now: Date = new Date()): void {
  if (now.getTime() - S.lastMaintenanceAt < MAINTENANCE_INTERVAL_MS || S.maintaining) return;
  S.lastMaintenanceAt = now.getTime();
  S.maintaining = runMaintenance(now)
    .catch(() => undefined)
    .finally(() => {
      S.maintaining = null;
    });
}

/**
 * Période de l'horloge d'entretien : plus courte que
 * {@link MAINTENANCE_INTERVAL_MS}, pour qu'un passage tombé à peine trop tôt
 * (minuteur en avance d'une milliseconde, entretien entraîné par le trafic
 * juste avant) ne repousse pas le suivant d'un intervalle entier.
 * `maintainAudience` garde la cadence de {@link MAINTENANCE_INTERVAL_MS}.
 */
export const MAINTENANCE_CLOCK_TICK_MS = 60_000;

/**
 * Lance l'entretien à intervalle régulier ({@link MAINTENANCE_INTERVAL_MS}, au
 * plus une minute de retard), une fois par processus (`instrumentation.ts` ;
 * l'horloge est sur `globalThis`, une seconde copie du module ne la double pas) : sans aucune visite mesurée
 * (nuit calme, oppositions, robots), le sel d'un jour clos est tout de même
 * effacé le lendemain et le détail purgé à son terme, comme l'annoncent les
 * textes. Sans effet si l'horloge tourne déjà ; ne retient pas le processus.
 */
export function startAudienceMaintenanceClock(): void {
  if (S.maintenanceClock) return;
  S.maintenanceClock = setInterval(() => maintainAudience(), MAINTENANCE_CLOCK_TICK_MS);
  S.maintenanceClock.unref?.();
}

/**
 * Journalise l'échec d'une étape de l'entretien (`error` non nul) au premier
 * passage qui échoue, puis plus jusqu'à ce qu'elle réussisse de nouveau : une
 * base en panne (ou absente, comme en intégration continue) ne remplit pas le
 * journal toutes les dix minutes. Un succès réarme l'alerte.
 */
function reportStep(step: MaintenanceStep, error: unknown, until?: string): void {
  if (error === null) {
    S.failing.delete(step);
    return;
  }
  if (S.failing.has(step)) return;
  S.failing.add(step);
  if (step === "rollup") console.error("[audience] Repli des jours clos impossible.", failureReason(error));
  else if (step === "salts") console.error(`[audience] Sels jusqu'au ${until} non effacés.`, failureReason(error));
  else console.error("[audience] Purge du détail impossible.", failureReason(error));
}

/**
 * Repli, effacement des sels des jours repliés, puis purge (attendus : tests, et
 * `maintainAudience`). Chaque étape ratée est journalisée ici ({@link reportStep}),
 * puis la première erreur est levée.
 */
export async function runMaintenance(now: Date = new Date()): Promise<void> {
  // Les signalements commencés avant l'entretien finissent, puis toute la file
  // part : rien d'un jour replié n'arrive après son repli. Ceux qui commencent
  // ensuite voient ce jour clos et l'écartent. L'attente est bornée : un
  // signalement qui la dépasse écarte ensuite ses lignes des jours repliés.
  await withTimeout(Promise.allSettled([...S.recording]), RECORDING_WAIT_MS, "audience recording wait timed out").catch(() => undefined);
  // Dès la fin de l'attente : un signalement attardé qui finit pendant le
  // vidage écarte ses lignes des jours à replier au lieu de les mettre en file.
  const until = lastRollableDay(now);
  const previous = S.rolledThrough;
  if (S.rolledThrough === null || until > S.rolledThrough) S.rolledThrough = until;
  let rolled = 0;
  let failure: unknown = null;
  try {
    for (let pass = 0; pass < 3 && (S.flushing || S.pending.length > 0); pass += 1) {
      await flushAudienceViews(now);
    }
    rolled = await rollUpAudienceDays(now);
    reportStep("rollup", null);
  } catch (error) {
    reportStep("rollup", error);
    // Repli raté : ces jours se replieront plus tard (le repli lit l'empreinte
    // gardée, jamais le sel). Un signalement attardé qui tient déjà leur sel
    // y ajoute encore ses lignes ; sans lui, plus aucun sel neuf n'est tiré
    // pour un jour clos (`loadSalt`) : ses lignes sont écartées.
    S.rolledThrough = previous;
    failure = error;
  }
  // Un jour clos n'a plus besoin de son sel, même si son repli a échoué : ses
  // entrées tardives sont écartées. La purge du détail ne dépend pas non plus
  // du repli : ni le sel ni le détail ne restent au-delà des durées annoncées.
  const [salted, purged] = await Promise.allSettled([forgetSalts(until), purgeAudienceViews(now)]);
  if (rolled > 0) {
    S.statsCache = null;
    S.statsGeneration += 1;
  }
  // Chaque échec du nettoyage se journalise, même quand le repli a échoué aussi :
  // un sel resté en base contredit ce que disent les textes, il doit se voir.
  reportStep("salts", salted.status === "rejected" ? salted.reason : null, until);
  reportStep("purge", purged.status === "rejected" ? purged.reason : null);
  if (failure !== null) throw failure;
  if (salted.status === "rejected") throw salted.reason;
  if (purged.status === "rejected") throw purged.reason;
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

/** Lignes brutes gardées en mémoire à la fois pour replier un jour : au-delà, le jour est replié par tranches de visiteurs. */
export const ROLLUP_SHARD_ROWS = 50_000;

interface CountRow extends RowDataPacket {
  total: number | string;
}

/** Colonne du détail de chaque répartition (constantes du code, jamais une saisie). */
const DISTINCT_COLUMNS: Readonly<Record<Parameters<AudienceDistinctCounter>[0], string>> = {
  page: "page_key",
  hour: "hour",
  device: "device",
  source: "source",
  locale: "locale",
};

/** Visiteurs distincts d'un jour ayant vu une page sous l'une des `values` d'une répartition. */
async function countDistinctVisitors(
  connection: PoolConnection,
  day: string,
  dim: Parameters<AudienceDistinctCounter>[0],
  values: readonly string[],
): Promise<number> {
  if (values.length === 0) return 0;
  const [rows] = await connection.execute<CountRow[]>(
    `SELECT COUNT(DISTINCT visitor_key) AS total
       FROM bg_audience_views
      WHERE day = ? AND is_view = 1 AND ${DISTINCT_COLUMNS[dim]} IN (${values.map(() => "?").join(", ")})`,
    [day, ...values],
  );
  return num(rows[0]?.total);
}

/** Ligne brute lue en base, en forme de calcul. */
function toRawRow(row: RawRow): AudienceRawRow {
  return {
    viewedAt: new Date(`${String(row.viewed_at).replace(" ", "T")}Z`),
    hour: Number(row.hour),
    visitorKey: row.visitor_key,
    pageKey: row.page_key,
    locale: row.locale,
    device: row.device,
    source: row.source,
    isView: Number(row.is_view) === 1,
    engagedMs: Number(row.engaged_ms),
  };
}

async function rollUpDay(connection: PoolConnection, day: string): Promise<void> {
  const [counted] = await connection.execute<CountRow[]>(`SELECT COUNT(*) AS total FROM bg_audience_views WHERE day = ?`, [day]);
  // Un visiteur reste dans une seule tranche (CRC32 de son empreinte) : les
  // compteurs de chaque tranche s'additionnent (`mergeAudienceAggregates`) et
  // la mémoire reste bornée sur une journée très fréquentée.
  const shards = Math.max(1, Math.ceil(num(counted[0]?.total) / ROLLUP_SHARD_ROWS));
  const parts: AudienceDayAggregate[] = [];
  let onlyShard: AudienceRawRow[] = [];
  for (let shard = 0; shard < shards; shard += 1) {
    const [rows] = await connection.execute<RawRow[]>(
      `SELECT viewed_at, hour, visitor_key, page_key, locale, device, source, is_view, engaged_ms
         FROM bg_audience_views
        WHERE day = ?${shards > 1 ? " AND MOD(CRC32(visitor_key), ?) = ?" : ""}
        ORDER BY viewed_at, id`,
      shards > 1 ? [day, shards, shard] : [day],
    );
    const raw = rows.map(toRawRow);
    if (shards === 1) onlyShard = raw;
    parts.push(aggregateAudienceDay(raw));
  }
  // Seules les lignes d'au moins `AUDIENCE_MIN_VISITORS` visiteurs distincts
  // du jour sont écrites (regroupées sinon) : la page publique ne lit qu'elles.
  // Jour d'une seule tranche : les visiteurs distincts se comptent dans le
  // détail déjà lu ; au-delà (tranches), une requête par étape.
  const aggregate = await anonymizeAudienceDay(
    parts.length === 1 ? parts[0] : mergeAudienceAggregates(parts),
    shards === 1 ? inMemoryDistinctCounter(onlyShard) : (dim, values) => countDistinctVisitors(connection, day, dim, values),
  );

  await writeDayAggregate(connection, day, aggregate);
}

/** Remplace les compteurs repliés d'un jour par `aggregate` (déjà k-anonyme). */
async function writeDayAggregate(connection: PoolConnection, day: string, aggregate: AudienceDayAggregate): Promise<void> {
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
  // Les compteurs du jour sont déjà k-anonymes (`anonymizeAudienceDay`, au
  // repli) : la lecture ne fait qu'additionner les jours de la période. Un
  // seuil appliqué ici, période par période, laisserait le groupe écarté se
  // déduire des totaux.
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
    // Types qui ne se mesurent plus fondus dans « Autres pages » (page publique).
    pages: publicPageStats(
      pages.map((row) => ({ key: row.page_key, views: num(row.views), visitors: num(row.visitors), engagedMs: num(row.engaged_ms) })),
    ),
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
               WHERE m.status = 'COMPLETED' AND m.is_bye = FALSE
                 AND t.state IN (${PLAYED_STATES_SQL}) AND t.start_visibility_at <= NOW()) AS matches,
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
  // Jamais d'attente du repli : la page sert le cache, ou lit les compteurs déjà
  // repliés (un jour = une transaction) ; un repli qui finit pendant la lecture
  // la rend périmée sans la mettre en cache (`statsGeneration`).
  if (S.statsCache && now.getTime() - S.statsCache.at < STATS_CACHE_MS) return S.statsCache.value;
  if (!S.statsLoad) {
    const generation = S.statsGeneration;
    S.statsLoad = loadStats()
      .then((value) => {
        // Un repli survenu pendant la lecture la rend périmée : servie, pas gardée.
        if (generation === S.statsGeneration) S.statsCache = { at: now.getTime(), value };
        return value;
      })
      .finally(() => {
        S.statsLoad = null;
      });
  }
  return S.statsLoad;
}

/** Remet l'état du module à zéro (tests). */
export function resetAudienceState(): void {
  S.salts.clear();
  if (S.maintenanceClock) clearInterval(S.maintenanceClock);
  S.maintenanceClock = null;
  if (S.saltSweep) clearInterval(S.saltSweep);
  S.saltSweep = null;
  S.recording.clear();
  S.pending = [];
  if (S.flushTimer) clearTimeout(S.flushTimer);
  S.flushTimer = null;
  S.flushing = null;
  S.lastMaintenanceAt = 0;
  S.rolledThrough = null;
  S.maintaining = null;
  S.statsCache = null;
  S.statsLoad = null;
  S.statsGeneration = 0;
  S.failing.clear();
}

/** File en attente d'écriture (tests). */
export function pendingAudienceCount(): number {
  return S.pending.length;
}
