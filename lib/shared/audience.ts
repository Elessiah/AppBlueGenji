/**
 * Statistiques de fréquentation détaillées — logique pure (importable partout).
 *
 * Seconde mesure, à côté du comptage des arrivées (`site-visits.ts`,
 * registre T06) : **pages vues, temps passé, moments de la semaine**, pour la
 * page non référencée `/frequentation` (`docs/features/AUDIENCE_MEASUREMENT.md`,
 * `docs/features/STATS_PAGE.md`). Elle tient dans la dispense de consentement
 * de la CNIL pour la mesure d'audience :
 *
 * - **aucun cookie, aucun stockage** dans le navigateur ;
 * - l'empreinte d'un visiteur est un HMAC de l'adresse IP et du navigateur sous
 *   un **sel tiré au hasard chaque jour**, effacé le lendemain dès le jour
 *   replié : deux jours ne se relient pas, et une fois le sel effacé, plus
 *   personne — l'association comprise — ne peut recalculer l'empreinte d'une
 *   adresse ;
 * - la page vue est réduite à son **gabarit** (`/joueurs/[pseudo]`, jamais le
 *   pseudo), la provenance à une **famille** (moteur de recherche, Discord…),
 *   l'écran à une **classe** (mobile, tablette, ordinateur) ;
 * - le détail est gardé {@link AUDIENCE_RAW_RETENTION_MONTHS} mois au plus,
 *   les compteurs par jour restent ;
 * - même opposition que la première mesure (GPC, DNT, bouton de `/rgpd`).
 */

import { SITE_TIME_ZONE } from "@/lib/shared/locales";

/** Durée de conservation du détail (une ligne par page vue), en mois. */
export const AUDIENCE_RAW_RETENTION_MONTHS = 13;

/** Temps de lecture retenu au plus pour une page vue : au-delà, l'onglet est oublié ouvert. */
export const AUDIENCE_MAX_ENGAGED_MS = 30 * 60 * 1000;

/** Écart entre deux pages vues d'un même visiteur au-delà duquel commence une nouvelle visite. */
export const AUDIENCE_VISIT_GAP_MINUTES = 30;

/**
 * Ancienneté maximale acceptée pour une entrée signalée en différé : au-delà,
 * l'entrée est écartée (jamais redatée, ce qui fausserait son heure).
 */
export const AUDIENCE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Ancienneté maximale de l'ouverture d'une page dont une suite arrive : au-delà,
 * le jour de cette page est replié depuis longtemps, la suite est écartée.
 */
export const AUDIENCE_MAX_OPEN_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Une lecture qui dure part par tranches d'au plus ce temps (plus le délai du
 * tic d'envoi) : chaque tranche reste sous {@link AUDIENCE_MAX_ENGAGED_MS}, et
 * son début se déduit exactement de sa fin.
 */
export const AUDIENCE_CHECKPOINT_MS = 10 * 60 * 1000;

/** Nombre maximal de pages vues par envoi du navigateur. */
export const AUDIENCE_MAX_BATCH = 20;

/** Le navigateur envoie sa file dès qu'elle atteint cette taille. */
export const AUDIENCE_CLIENT_FLUSH_SIZE = 10;

/** …ou au plus tard après ce délai. */
export const AUDIENCE_CLIENT_FLUSH_MS = 60_000;

/** Adresse publique (non référencée) de la page de fréquentation. */
export const AUDIENCE_PAGE_PATH = "/frequentation";

export type AudienceDevice = "mobile" | "tablet" | "desktop";
export const AUDIENCE_DEVICES: readonly AudienceDevice[] = ["mobile", "tablet", "desktop"];

export type AudienceSource = "direct" | "search" | "discord" | "social" | "video" | "other" | "internal";
/** Les familles de provenance d'une **arrivée** (`internal` n'en est pas une). */
export const AUDIENCE_SOURCES: readonly Exclude<AudienceSource, "internal">[] = [
  "direct",
  "search",
  "discord",
  "social",
  "video",
  "other",
];

export type AudienceLocale = "fr" | "en";
export const AUDIENCE_LOCALES: readonly AudienceLocale[] = ["fr", "en"];

/**
 * Gabarits des pages mesurées, dans l'ordre de reconnaissance. Une page ne
 * se range que sous son gabarit : jamais un identifiant, un pseudo ou un nom
 * d'équipe n'est conservé.
 */
const PAGE_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ["home", /^\/$/],
  ["rules", /^\/regles$/],
  ["rulesMode", /^\/regles\/[^/]+$/],
  ["ranking", /^\/classement$/],
  ["tournaments", /^\/tournois$/],
  ["tournament", /^\/tournois\/\d+$/],
  ["match", /^\/tournois\/\d+\/matchs\/\d+$/],
  ["tournamentOther", /^\/tournois\/.+$/],
  ["follow", /^\/suivre(\/.*)?$/],
  ["teams", /^\/equipes$/],
  ["team", /^\/equipes\/.+$/],
  ["players", /^\/joueurs$/],
  ["player", /^\/joueurs\/.+$/],
  ["profile", /^\/profil(\/.*)?$/],
  ["login", /^\/connexion(\/.*)?$/],
  ["bot", /^\/bot(\/.*)?$/],
  ["association", /^\/association$/],
  ["volunteers", /^\/benevoles$/],
  ["recruitment", /^\/recrutement$/],
  ["legal", /^\/(rgpd|mentions-legales|conditions-utilisation|accessibilite|privacy-policy-bot|terms-of-service-bot)(\/.*)?$/],
  ["reports", /^\/signalements(\/.*)?$/],
  ["admin", /^\/admin(\/.*)?$/],
];

/** Toutes les clés de page possibles, `other` compris (pour les libellés). */
export const AUDIENCE_PAGE_KEYS: readonly string[] = [...PAGE_PATTERNS.map(([key]) => key), "other"];

/** Langue et chemin sans préfixe d'une adresse du site (`/en/regles` → `en`, `/regles`). */
export function splitLocalePath(path: string): { locale: AudienceLocale; path: string } {
  if (path === "/en" || path.startsWith("/en/")) {
    return { locale: "en", path: path.slice(3) || "/" };
  }
  return { locale: "fr", path };
}

/**
 * Gabarit d'une page, ou `null` pour une adresse qui ne se mesure pas (API,
 * images, la page de fréquentation elle-même).
 */
export function audiencePageKey(rawPath: unknown): { key: string; locale: AudienceLocale } | null {
  if (typeof rawPath !== "string") return null;
  let path = rawPath.trim().split("?")[0].split("#")[0];
  if (!path.startsWith("/") || path.length > 512) return null;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const split = splitLocalePath(path);
  const bare = split.path;
  if (bare === AUDIENCE_PAGE_PATH || bare.startsWith(`${AUDIENCE_PAGE_PATH}/`)) return null;
  if (/^\/(api|og|_next)(\/|$)/.test(bare)) return null;
  const match = PAGE_PATTERNS.find(([, pattern]) => pattern.test(bare));
  return { key: match ? match[0] : "other", locale: split.locale };
}

/** Classe d'écran d'après la largeur de la fenêtre (en pixels CSS). */
export function deviceFromWidth(width: unknown): AudienceDevice {
  const value = typeof width === "number" && Number.isFinite(width) ? width : 1280;
  if (value < 640) return "mobile";
  if (value < 1024) return "tablet";
  return "desktop";
}

/** Une classe d'écran envoyée par le navigateur, ramenée à une valeur connue. */
export function parseDevice(value: unknown): AudienceDevice {
  return AUDIENCE_DEVICES.includes(value as AudienceDevice) ? (value as AudienceDevice) : "desktop";
}

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|qwant|ecosia|yahoo|yandex|startpage|search\.brave|baidu|lilo)\./;
const DISCORD_HOSTS = /(^|\.)(discord\.com|discord\.gg|discordapp\.com|discordapp\.net)$/;
const SOCIAL_HOSTS = /(^|\.)(twitter\.com|x\.com|t\.co|facebook\.com|fb\.com|instagram\.com|reddit\.com|tiktok\.com|linkedin\.com|lnkd\.in|bsky\.app|threads\.net|mastodon\.social)$/;
const VIDEO_HOSTS = /(^|\.)(twitch\.tv|youtube\.com|youtu\.be|kick\.com)$/;

/** Nom d'hôte ramené à sa forme comparable (minuscules, sans `www.`). */
function bareHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "");
}

/**
 * Famille de provenance d'une arrivée, d'après le **seul nom d'hôte** du
 * référent (jamais son chemin) — et seul ce nom de famille est gardé.
 */
export function sourceFromReferrerHost(host: unknown, ownHost?: string | null): Exclude<AudienceSource, "internal"> {
  if (typeof host !== "string") return "direct";
  const name = bareHost(host);
  if (!name || name.length > 253) return "direct";
  if (ownHost && name === bareHost(ownHost)) return "direct";
  if (SEARCH_HOSTS.test(name)) return "search";
  if (DISCORD_HOSTS.test(name)) return "discord";
  if (SOCIAL_HOSTS.test(name)) return "social";
  if (VIDEO_HOSTS.test(name)) return "video";
  return "other";
}

/** Robots, aperçus de liens et clients sans navigateur : ils ne sont pas des visiteurs. */
const BOT_USER_AGENT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|pingdom|monitor|curl|wget|python-requests|httpclient/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== "string" || !userAgent.trim()) return true;
  return BOT_USER_AGENT.test(userAgent);
}

/** Une page vue telle que le navigateur la signale. */
export interface AudienceBeaconEntry {
  /** Chemin de la page (sans paramètres). */
  p: string;
  /** Temps passé onglet visible, en millisecondes (`0` pour une page vue, signalée à son affichage). */
  t: number;
  /**
   * Ancienneté, au moment de l'envoi, de l'instant que l'entrée date : le
   * début de la page vue, ou la clôture de la lecture pour une suite.
   */
  a: number;
  /** Classe d'écran. */
  d: AudienceDevice;
  /** Nom d'hôte du référent, pour la première page d'une arrivée seulement. */
  r?: string | null;
  /** 1 = première page de l'arrivée ; 0 = navigation interne. */
  f?: 0 | 1;
  /** 1 = suite d'une page déjà comptée (son temps de lecture, à sa clôture) : temps seul. */
  c?: 0 | 1;
  /**
   * Suite seulement : ancienneté, au moment de l'envoi, de l'ouverture de la
   * page vue qu'elle prolonge — la suite se range au jour de cette page.
   */
  o?: number;
}

/** Une page vue validée, prête pour le serveur. */
export interface AudienceView {
  pageKey: string;
  locale: AudienceLocale;
  device: AudienceDevice;
  source: AudienceSource;
  /** `false` : suite d'une page déjà comptée, qui n'apporte que du temps. */
  isView: boolean;
  engagedMs: number;
  /** Ancienneté de l'instant daté (début de la page vue, ou clôture de la lecture). */
  ageMs: number;
  /** Ancienneté de l'ouverture de la page vue (égale à `ageMs` pour une page vue) : fixe son jour. */
  openedAgeMs: number;
}

function clampInt(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Ancienneté de l'ouverture de la page qu'une suite prolonge : jamais après sa
 * clôture (`ageMs`) ; absente (ancien script) ou illisible, la suite se range
 * au jour de sa clôture. `null` au-delà de {@link AUDIENCE_MAX_OPEN_AGE_MS}.
 */
function continuationOpenAge(raw: unknown, ageMs: number): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return ageMs;
  const opened = Math.round(raw);
  if (opened > AUDIENCE_MAX_OPEN_AGE_MS) return null;
  return Math.max(ageMs, opened);
}

/**
 * Valide un envoi du navigateur. Tolérant : une entrée illisible est écartée,
 * jamais l'envoi entier ; au-delà de {@link AUDIENCE_MAX_BATCH} entrées, le
 * reste est ignoré.
 */
export function parseAudienceBatch(body: unknown, ownHost?: string | null): AudienceView[] {
  const list = (body as { v?: unknown } | null)?.v;
  if (!Array.isArray(list)) return [];
  const views: AudienceView[] = [];
  for (const raw of list.slice(0, AUDIENCE_MAX_BATCH)) {
    const view = parseAudienceEntry(raw, ownHost);
    if (view) views.push(view);
  }
  return views;
}

/** Une entrée de l'envoi, ou `null` si elle est illisible ou trop ancienne. */
function parseAudienceEntry(raw: unknown, ownHost?: string | null): AudienceView | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Partial<Record<keyof AudienceBeaconEntry, unknown>>;
  const page = audiencePageKey(entry.p);
  if (!page) return null;
  // Trop ancienne pour être datée juste : écartée plutôt que redatée.
  const age = typeof entry.a === "number" && Number.isFinite(entry.a) ? Math.round(entry.a) : 0;
  if (age > AUDIENCE_MAX_AGE_MS) return null;
  const isView = entry.c !== 1;
  const ageMs = Math.max(0, age);
  const openedAgeMs = isView ? ageMs : continuationOpenAge(entry.o, ageMs);
  if (openedAgeMs === null) return null;
  return {
    pageKey: page.key,
    locale: page.locale,
    device: parseDevice(entry.d),
    source: isView && entry.f === 1 ? sourceFromReferrerHost(entry.r, ownHost) : "internal",
    isView,
    engagedMs: clampInt(entry.t, 0, AUDIENCE_MAX_ENGAGED_MS),
    ageMs,
    openedAgeMs,
  };
}

const PARIS_CLOCK = new Intl.DateTimeFormat("en-CA", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Jour (`AAAA-MM-JJ`), heure (0–23) et minute d'un instant, à l'heure de Paris. */
export function parisClock(date: Date): { day: string; hour: number; minute: number } {
  const parts = PARIS_CLOCK.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, minute: Number(get("minute")) };
}

/** Jour `AAAA-MM-JJ` décalé de `delta` jours (calendrier, sans fuseau). */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Jour `AAAA-MM-JJ` décalé de `delta` mois, borné au dernier jour du mois visé. */
export function shiftMonths(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Jour de la semaine d'un jour `AAAA-MM-JJ`, lundi = 0 … dimanche = 6. */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Lundi de la semaine d'un jour. */
export function weekStart(day: string): string {
  return shiftDay(day, -weekdayIndex(day));
}

/** Une ligne du détail, telle que le repli la lit. */
export interface AudienceRawRow {
  viewedAt: Date;
  hour: number;
  visitorKey: string;
  pageKey: string;
  locale: string;
  device: string;
  source: string;
  isView: boolean;
  engagedMs: number;
}

export interface AudienceDayTotals {
  views: number;
  visitors: number;
  visits: number;
  bounces: number;
  engagedMs: number;
}

export type AudienceDim = "device" | "source" | "locale";

export interface AudienceDayAggregate {
  totals: AudienceDayTotals;
  pages: { pageKey: string; views: number; visitors: number; engagedMs: number }[];
  hours: { hour: number; views: number; visitors: number }[];
  dims: { dim: AudienceDim; value: string; views: number; visitors: number }[];
}

interface Tally {
  views: number;
  visitors: Set<string>;
}

function tally<K>(map: Map<K, Tally>, key: K, visitor: string): Tally {
  const entry = map.get(key) ?? { views: 0, visitors: new Set<string>() };
  entry.views += 1;
  entry.visitors.add(visitor);
  map.set(key, entry);
  return entry;
}

/**
 * Découpe en visites l'activité des visiteurs d'une journée (lignes triées par
 * date) : voir {@link aggregateAudienceDay}.
 */
class VisitCounter {
  private readonly lastSeen = new Map<string, { at: number; views: number }>();
  visits = 0;
  bounces = 0;

  constructor(private readonly gapMs: number) {}

  /**
   * Fin d'une lecture (`engagedMs` de temps) datée de sa clôture `at`.
   *
   * @returns `true` si la lecture prolonge une visite (son temps lui revient).
   */
  continuation(visitor: string, at: number, engagedMs: number): boolean {
    const previous = this.lastSeen.get(visitor);
    if (!previous || previous.views === 0) return false;
    if (at - engagedMs - previous.at < this.gapMs) {
      // Lecture commencée dans la visite : la prolonge.
      this.lastSeen.set(visitor, { at: Math.max(at, previous.at), views: previous.views });
      return true;
    }
    // Retour sur l'onglet après une longue pause : la visite d'avant est close,
    // cette lecture n'en ouvre aucune (aucune page vue) et son temps n'est pas compté.
    if (previous.views === 1) this.bounces += 1;
    this.lastSeen.set(visitor, { at, views: 0 });
    return false;
  }

  /** Ouverture d'une page à `at`. */
  view(visitor: string, at: number): void {
    const previous = this.lastSeen.get(visitor);
    if (previous && previous.views > 0 && at - previous.at < this.gapMs) {
      this.lastSeen.set(visitor, { at: Math.max(at, previous.at), views: previous.views + 1 });
      return;
    }
    if (previous?.views === 1) this.bounces += 1;
    this.visits += 1;
    this.lastSeen.set(visitor, { at, views: 1 });
  }

  /** Clôt les visites encore ouvertes en fin de journée. */
  finish(): void {
    for (const last of this.lastSeen.values()) if (last.views === 1) this.bounces += 1;
    this.lastSeen.clear();
  }
}

/**
 * Replie les pages vues d'une journée en compteurs. Les lignes doivent être
 * triées par `viewedAt`. Une **visite** est une suite de pages d'un même
 * visiteur dont chacune s'ouvre moins de {@link AUDIENCE_VISIT_GAP_MINUTES}
 * minutes après la **dernière activité** de la visite — l'ouverture d'une page
 * ou la fin d'une lecture (une suite est datée de sa clôture) : une longue
 * lecture ne coupe pas la visite (le navigateur l'envoie par tranches d'au
 * plus {@link AUDIENCE_CHECKPOINT_MS}). Un **rebond** est une visite d'une
 * seule page. Le temps d'une suite (`isView = false`) s'ajoute à sa page sans
 * compter de page vue — s'il prolonge une visite ; un temps hors de toute
 * visite (retour après une longue pause, suite sans sa page vue) n'est pas
 * compté, pour ne gonfler ni le temps par visite ni le temps par page.
 */
export function aggregateAudienceDay(rows: readonly AudienceRawRow[]): AudienceDayAggregate {
  const visitors = new Set<string>();
  const pageViews = new Map<string, Tally>();
  const pageTime = new Map<string, number>();
  const hours = new Map<number, Tally>();
  const dims = new Map<string, Tally>();
  const visitCounter = new VisitCounter(AUDIENCE_VISIT_GAP_MINUTES * 60_000);
  let views = 0;
  let engagedMs = 0;

  const addTime = (pageKey: string, time: number) => {
    engagedMs += time;
    pageTime.set(pageKey, (pageTime.get(pageKey) ?? 0) + time);
  };
  for (const row of rows) {
    if (!row.isView) {
      if (visitCounter.continuation(row.visitorKey, row.viewedAt.getTime(), row.engagedMs)) addTime(row.pageKey, row.engagedMs);
      continue;
    }
    addTime(row.pageKey, row.engagedMs);

    views += 1;
    visitors.add(row.visitorKey);
    tally(pageViews, row.pageKey, row.visitorKey);
    tally(hours, row.hour, row.visitorKey);
    tally(dims, `device\u0000${row.device}`, row.visitorKey);
    tally(dims, `locale\u0000${row.locale}`, row.visitorKey);
    if (row.source !== "internal") tally(dims, `source\u0000${row.source}`, row.visitorKey);
    visitCounter.view(row.visitorKey, row.viewedAt.getTime());
  }
  visitCounter.finish();

  return {
    totals: { views, visitors: visitors.size, visits: visitCounter.visits, bounces: visitCounter.bounces, engagedMs },
    pages: [...pageTime.entries()].map(([pageKey, time]) => {
      const entry = pageViews.get(pageKey);
      return { pageKey, views: entry?.views ?? 0, visitors: entry?.visitors.size ?? 0, engagedMs: time };
    }),
    hours: [...hours.entries()].map(([hour, entry]) => ({ hour, views: entry.views, visitors: entry.visitors.size })),
    dims: [...dims.entries()].map(([key, entry]) => {
      const [dim, value] = key.split("\u0000") as [AudienceDim, string];
      return { dim, value, views: entry.views, visitors: entry.visitors.size };
    }),
  };
}

// ---------------------------------------------------------------------------
// Lecture : ce que la page reçoit, et les calculs qu'elle en fait.
// ---------------------------------------------------------------------------

export type AudienceRange = "7d" | "30d" | "12m" | "all";
export const AUDIENCE_RANGES: readonly AudienceRange[] = ["7d", "30d", "12m", "all"];

/** Premier jour couvert par une période qui finit `lastDay` (inclus), ou `null` pour « tout ». */
export function rangeStart(range: AudienceRange, lastDay: string): string | null {
  if (range === "7d") return shiftDay(lastDay, -6);
  if (range === "30d") return shiftDay(lastDay, -29);
  if (range === "12m") return shiftDay(shiftMonths(lastDay, -12), 1);
  return null;
}

export interface AudienceDailyPoint extends AudienceDayTotals {
  day: string;
}

export interface AudienceShare {
  key: string;
  views: number;
  visitors: number;
}

export interface AudiencePageStat {
  key: string;
  views: number;
  visitors: number;
  engagedMs: number;
}

export interface AudienceRangeStats {
  pages: AudiencePageStat[];
  /** Pages vues, [jour de la semaine, lundi = 0][heure]. */
  heatmap: number[][];
  devices: AudienceShare[];
  sources: AudienceShare[];
  locales: AudienceShare[];
}

export interface AudienceCommunity {
  tournaments: number;
  matches: number;
  teams: number;
  players: number;
}

export interface AudienceStats {
  /** Dernier jour compté (la veille, heure de Paris) ; `null` tant que rien n'est replié. */
  lastDay: string | null;
  firstDay: string | null;
  daily: AudienceDailyPoint[];
  ranges: Record<AudienceRange, AudienceRangeStats>;
  community: AudienceCommunity | null;
}

/** Une grille 7 × 24 de zéros. */
export function emptyHeatmap(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

/** Série quotidienne complète entre deux jours : un jour sans ligne vaut zéro. */
export function fillDailySeries(points: readonly AudienceDailyPoint[], from: string, to: string): AudienceDailyPoint[] {
  const byDay = new Map(points.map((point) => [point.day, point]));
  const out: AudienceDailyPoint[] = [];
  for (let day = from; day <= to && out.length < 20_000; day = shiftDay(day, 1)) {
    out.push(byDay.get(day) ?? { day, views: 0, visitors: 0, visits: 0, bounces: 0, engagedMs: 0 });
  }
  return out;
}

/** Somme de points quotidiens. */
export function sumTotals(points: readonly AudienceDayTotals[]): AudienceDayTotals {
  return points.reduce<AudienceDayTotals>(
    (acc, point) => ({
      views: acc.views + point.views,
      visitors: acc.visitors + point.visitors,
      visits: acc.visits + point.visits,
      bounces: acc.bounces + point.bounces,
      engagedMs: acc.engagedMs + point.engagedMs,
    }),
    { views: 0, visitors: 0, visits: 0, bounces: 0, engagedMs: 0 },
  );
}

export type AudienceBucket = "day" | "week" | "month" | "year";

/** Clé de regroupement d'un jour : lui-même, son lundi, son mois (`AAAA-MM`) ou son année. */
export function bucketKey(day: string, bucket: AudienceBucket): string {
  if (bucket === "week") return weekStart(day);
  if (bucket === "month") return day.slice(0, 7);
  if (bucket === "year") return day.slice(0, 4);
  return day;
}

/** Regroupe une série quotidienne par semaine, mois ou année (sommes ; un visiteur compte une fois par jour). */
export function groupDaily(points: readonly AudienceDailyPoint[], bucket: AudienceBucket): ({ key: string } & AudienceDayTotals)[] {
  const groups = new Map<string, AudienceDailyPoint[]>();
  for (const point of points) {
    const key = bucketKey(point.day, bucket);
    const list = groups.get(key) ?? [];
    list.push(point);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, ...sumTotals(list) }));
}

/** Indicateurs d'une période. */
export interface AudienceKpis {
  views: number;
  visitors: number;
  visits: number;
  avgVisitorsPerDay: number;
  /** Secondes par page vue. */
  avgSecondsPerPage: number;
  /** Secondes par visite. */
  avgSecondsPerVisit: number;
  pagesPerVisit: number;
  /** Part des visites d'une seule page, de 0 à 1. */
  bounceRate: number;
}

export function kpisOf(points: readonly AudienceDailyPoint[]): AudienceKpis {
  const totals = sumTotals(points);
  const days = Math.max(1, points.length);
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    views: totals.views,
    visitors: totals.visitors,
    visits: totals.visits,
    avgVisitorsPerDay: totals.visitors / days,
    avgSecondsPerPage: ratio(totals.engagedMs, totals.views) / 1000,
    avgSecondsPerVisit: ratio(totals.engagedMs, totals.visits) / 1000,
    pagesPerVisit: ratio(totals.views, totals.visits),
    bounceRate: ratio(totals.bounces, totals.visits),
  };
}

/** Évolution relative (`0.12` = +12 %) d'une période sur la précédente, ou `null` sans base. */
export function relativeChange(current: number, previous: number): number | null {
  if (Number.isNaN(previous) || previous <= 0) return null;
  return (current - previous) / previous;
}

/** Durée lisible en minutes et secondes (`2 min 05 s`, `48 s`). */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return `${rest} s`;
  return `${minutes} min ${String(rest).padStart(2, "0")} s`;
}

/** Parts en pourcentage entier dont la somme fait 100 (plus forts restes). */
export function percentShares(values: readonly number[]): number[] {
  const total = values.reduce((acc, value) => acc + value, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((value) => (value / total) * 100);
  const floors = raw.map((value) => Math.floor(value));
  let left = 100 - floors.reduce((acc, value) => acc + value, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

/** Remplit les `{nom}` d'un message de la page (sans `next-intl`, que la page ne charge pas). */
export function fillTemplate(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** Pages vues réparties par jour de la semaine (lundi = 0) et par heure, depuis la grille 7 × 24. */
export function heatmapMargins(heatmap: readonly (readonly number[])[]): { weekdays: number[]; hours: number[] } {
  const weekdays = Array.from({ length: 7 }, (_, day) => (heatmap[day] ?? []).reduce((acc, value) => acc + value, 0));
  const hours = Array.from({ length: 24 }, (_, hour) => heatmap.reduce((acc, row) => acc + (row[hour] ?? 0), 0));
  return { weekdays, hours };
}
