/**
 * Enregistrement et agrégation de la fréquentation du site.
 *
 * Le compteur vit dans `bg_site_visits` : une ligne par visite, une visite
 * valant l'arrivée d'un visiteur (les chargements suivants d'une même fenêtre de
 * {@link SITE_VISIT_WINDOW_MINUTES} minutes sont regroupés). Rien n'est
 * pré-agrégé : les totaux se recalculent à la lecture, donc une purge de la
 * table se répercute d'elle-même.
 *
 * Vie privée : seule une empreinte SHA-256 salée est stockée
 * ({@link lib/shared/site-visits.visitorIdentitySource}) — jamais l'IP ni le
 * user-agent.
 *
 * Le résultat est poussé au bot Discord par le canal interne déjà existant
 * (`lib/server/bot-integration.ts`), qui le sert à la commande `/stats-site`.
 */
import { createHash } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { toIso } from "./serialization";
import { pushSiteVisitStats } from "./bot-integration";
import {
  normalizeVisitPath,
  SITE_VISIT_WINDOW_MINUTES,
  visitorIdentitySource,
} from "@/lib/shared/site-visits";
import type { SiteVisitStats } from "@/lib/shared/types";

/** Cadence maximale de synchronisation vers le bot (le snapshot ne bouge qu'à l'insertion). */
const BOT_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Garde-fou de débit : nombre maximal d'enregistrements acceptés par IP et par
 * minute. Un visiteur réel en produit au plus deux par heure (fenêtre de
 * session) ; le plafond ne gêne donc qu'un client qui fabrique des empreintes en
 * boucle pour gonfler les compteurs — chaque empreinte neuve échappant par
 * construction à la fenêtre de session, c'est le seul rempart contre une
 * croissance illimitée de la table.
 */
const VISIT_RATE_LIMIT_PER_MINUTE = 30;
const VISIT_RATE_WINDOW_MS = 60 * 1000;
/** Plafond d'IP suivies simultanément, pour que le limiteur reste borné en mémoire. */
const VISIT_RATE_MAX_TRACKED_IPS = 10_000;

let lastBotSyncAt = 0;
const visitRateBuckets = new Map<string, { count: number; resetAt: number }>();

interface VisitStatsRow extends RowDataPacket {
  total_visits: number | string | null;
  unique_visitors: number | string | null;
  identified_visitors: number | string | null;
  visits_24h: number | string | null;
  unique_24h: number | string | null;
  visits_7d: number | string | null;
  unique_7d: number | string | null;
  visits_30d: number | string | null;
  unique_30d: number | string | null;
  first_visit_at: string | Date | null;
  last_visit_at: string | Date | null;
}

/**
 * Sel de hachage des empreintes. `VISIT_HASH_SALT` en priorité ; à défaut, le
 * secret interne déjà partagé avec le bot. Sans aucun des deux (dev local), un
 * sel constant garde la fonctionnalité utilisable — les empreintes restent
 * inexploitables hors de la base, mais théoriquement rejouables : renseigner la
 * variable en production.
 */
function visitHashSalt(): string {
  return process.env.VISIT_HASH_SALT?.trim() || process.env.BOT_INTERNAL_TOKEN?.trim() || "bg-site-visits";
}

function hashVisitorIdentity(source: string): string {
  return createHash("sha256").update(`${visitHashSalt()}:${source}`).digest("hex");
}

function rateLimitKey(ip: string | null | undefined): string {
  return (ip ?? "").trim() || "unknown-ip";
}

/**
 * Le quota de cette IP est-il déjà épuisé ?
 *
 * Fenêtre fixe d'une minute, en mémoire du processus : volontairement
 * approximatif (plusieurs instances comptent chacune de leur côté), mais cela
 * borne la croissance de la table — ce qu'aucune déduplication par empreinte ne
 * peut faire, l'empreinte étant fournie par le client.
 */
function isVisitRateExceeded(ip: string | null | undefined): boolean {
  const bucket = visitRateBuckets.get(rateLimitKey(ip));
  if (!bucket || Date.now() >= bucket.resetAt) return false;
  return bucket.count >= VISIT_RATE_LIMIT_PER_MINUTE;
}

/**
 * Décompte une **ligne réellement insérée** du quota de l'IP.
 *
 * C'est l'insertion qu'on plafonne, pas la requête : un visiteur dont le
 * chargement est absorbé par la fenêtre de session ne consomme rien. Sans cette
 * nuance, plusieurs vrais visiteurs partageant une sortie NAT (école,
 * entreprise, réseau mobile) s'épuiseraient mutuellement leur quota et seraient
 * sous-comptés — alors que le client qui fabrique une empreinte neuve à chaque
 * requête, lui, insère à chaque fois et atteint donc le plafond tout de suite.
 */
function chargeVisitToRateLimit(ip: string | null | undefined): void {
  const key = rateLimitKey(ip);
  const now = Date.now();

  const bucket = visitRateBuckets.get(key);
  if (bucket && now < bucket.resetAt) {
    bucket.count += 1;
    return;
  }

  // Purge opportuniste : on ne balaie la table qu'au moment où elle déborde,
  // pour ne pas payer un parcours à chaque visite.
  if (visitRateBuckets.size >= VISIT_RATE_MAX_TRACKED_IPS) {
    for (const [trackedKey, tracked] of visitRateBuckets) {
      if (now >= tracked.resetAt) visitRateBuckets.delete(trackedKey);
    }
    // Toujours plein de fenêtres actives : on repart de zéro plutôt que de
    // laisser la mémoire filer.
    if (visitRateBuckets.size >= VISIT_RATE_MAX_TRACKED_IPS) visitRateBuckets.clear();
  }

  visitRateBuckets.set(key, { count: 1, resetAt: now + VISIT_RATE_WINDOW_MS });
}

/** Vide le limiteur de débit (tests). */
export function resetVisitRateLimit(): void {
  visitRateBuckets.clear();
}

function count(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Statistiques vides — celles d'une table encore vierge.
 *
 * À ne pas confondre avec une lecture impossible, que {@link getSiteVisitStats}
 * signale par `null` : ces zéros-là sont un résultat légitime, et sont poussés
 * au bot comme tels.
 */
export function emptySiteVisitStats(): SiteVisitStats {
  return {
    totalVisits: 0,
    uniqueVisitors: 0,
    visitsLast24h: 0,
    uniqueVisitorsLast24h: 0,
    visitsLast7Days: 0,
    uniqueVisitorsLast7Days: 0,
    visitsLast30Days: 0,
    uniqueVisitorsLast30Days: 0,
    identifiedVisitors: 0,
    firstVisitAt: null,
    lastVisitAt: null,
  };
}

/**
 * Enregistre une visite si le visiteur n'en a pas déjà une dans la fenêtre de
 * session courante.
 *
 * L'insertion conditionnelle est faite en une seule requête (`INSERT … SELECT …
 * WHERE NOT EXISTS`) plutôt qu'en « lire puis insérer » : la fenêtre de course
 * se réduit à l'exécution d'une requête, et disparaît tout à fait tant que
 * MySQL verrouille la lecture (isolation `REPEATABLE READ`, celle par défaut).
 * En `READ COMMITTED`, la lecture est cohérente mais non verrouillée : deux
 * chargements rigoureusement simultanés peuvent alors compter deux visites.
 * L'écart est d'une unité et sans effet sur le nombre de visiteurs uniques —
 * aucun invariant de schéma ne peut de toute façon exprimer « une seule ligne
 * par fenêtre glissante ».
 *
 * @returns `recorded = true` si une visite a bien été créée (donc si les
 * compteurs ont changé), `false` si elle a été absorbée par la fenêtre.
 */
export async function recordSiteVisit(input: {
  userId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  path?: unknown;
}): Promise<{ recorded: boolean }> {
  // L'empreinte étant dérivée d'en-têtes fournis par le client, la fenêtre de
  // session ne protège pas d'un client qui en change à chaque requête : le
  // plafond d'insertions par IP, lui, tient.
  if (isVisitRateExceeded(input.ip)) return { recorded: false };

  const visitorKey = hashVisitorIdentity(visitorIdentitySource(input));
  const path = normalizeVisitPath(input.path);
  const userId =
    typeof input.userId === "number" && Number.isInteger(input.userId) && input.userId > 0
      ? input.userId
      : null;

  const db = await getDatabase();
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_site_visits (visitor_key, user_id, path)
     SELECT ?, ?, ?
     FROM DUAL
     WHERE NOT EXISTS (
       SELECT 1 FROM (
         SELECT 1 FROM bg_site_visits
         WHERE visitor_key = ?
           AND created_at > (NOW() - INTERVAL ? MINUTE)
         LIMIT 1
       ) AS recent
     )`,
    [visitorKey, userId, path, visitorKey, SITE_VISIT_WINDOW_MINUTES],
  );

  const recorded = result.affectedRows > 0;
  if (recorded) chargeVisitToRateLimit(input.ip);

  return { recorded };
}

/**
 * Fréquentation agrégée : totaux, uniques et fenêtres glissantes.
 *
 * @returns Les compteurs, ou `null` si la base est injoignable. La distinction
 * compte : une table réellement vide vaut des zéros légitimes, tandis qu'une
 * lecture impossible ne doit **pas** en produire — sinon la synchronisation
 * écraserait le dernier bon instantané du bot avec des zéros.
 */
export async function getSiteVisitStats(): Promise<SiteVisitStats | null> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<VisitStatsRow[]>(
      `SELECT
         COUNT(*) AS total_visits,
         COUNT(DISTINCT visitor_key) AS unique_visitors,
         COUNT(DISTINCT user_id) AS identified_visitors,
         SUM(created_at >= NOW() - INTERVAL 1 DAY) AS visits_24h,
         COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL 1 DAY THEN visitor_key END) AS unique_24h,
         SUM(created_at >= NOW() - INTERVAL 7 DAY) AS visits_7d,
         COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL 7 DAY THEN visitor_key END) AS unique_7d,
         SUM(created_at >= NOW() - INTERVAL 30 DAY) AS visits_30d,
         COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL 30 DAY THEN visitor_key END) AS unique_30d,
         MIN(created_at) AS first_visit_at,
         MAX(created_at) AS last_visit_at
       FROM bg_site_visits`,
    );

    const row = rows[0];
    if (!row) return emptySiteVisitStats();

    return {
      totalVisits: count(row.total_visits),
      uniqueVisitors: count(row.unique_visitors),
      visitsLast24h: count(row.visits_24h),
      uniqueVisitorsLast24h: count(row.unique_24h),
      visitsLast7Days: count(row.visits_7d),
      uniqueVisitorsLast7Days: count(row.unique_7d),
      visitsLast30Days: count(row.visits_30d),
      uniqueVisitorsLast30Days: count(row.unique_30d),
      identifiedVisitors: count(row.identified_visitors),
      firstVisitAt: toIso(row.first_visit_at as string | null),
      lastVisitAt: toIso(row.last_visit_at as string | null),
    };
  } catch {
    // Fréquentation = agrément, jamais un motif d'erreur pour l'appelant : on
    // signale l'échec par `null` plutôt que par une exception.
    return null;
  }
}

/**
 * Pousse la fréquentation au bot par le canal interne existant, au plus une fois
 * toutes les {@link BOT_SYNC_INTERVAL_MS} millisecondes.
 *
 * Appelé après une visite réellement enregistrée : tant que personne ne visite,
 * les chiffres ne bougent pas et le snapshot du bot reste juste. L'envoi est en
 * meilleur effort — `bot-integration` dégrade déjà (timeout + coupe-circuit).
 *
 * Une lecture impossible **n'envoie rien** : mieux vaut un instantané un peu
 * vieux chez le bot que des zéros. La cadence n'est alors pas consommée, pour
 * que la visite suivante retente aussitôt.
 *
 * @param force Ignore la cadence (utilisé par les tests et un appel manuel).
 * @returns `true` si une synchronisation a bien eu lieu.
 */
export async function syncSiteVisitStatsToBot(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastBotSyncAt < BOT_SYNC_INTERVAL_MS) return false;

  const stats = await getSiteVisitStats();
  if (!stats) return false;

  lastBotSyncAt = now;
  await pushSiteVisitStats(stats);
  return true;
}

/** Réinitialise la cadence de synchronisation (tests). */
export function resetSiteVisitSyncThrottle(): void {
  lastBotSyncAt = 0;
}
