/**
 * Enregistrement et agrégation de la fréquentation du site.
 *
 * Le compteur vit dans `bg_site_visits` : une ligne par visite, une visite
 * valant l'arrivée d'un visiteur (les chargements suivants d'une même fenêtre de
 * {@link SITE_VISIT_WINDOW_MINUTES} minutes sont regroupés). Ce détail n'est
 * gardé que {@link SITE_VISIT_DETAIL_RETENTION_DAYS} jours : les jours révolus
 * sont **repliés** en un compteur par jour (`bg_site_visit_days`) puis effacés,
 * et chaque visiteur laisse une seule empreinte dans `bg_site_visitors`, datée
 * de sa dernière visite et effacée {@link SITE_VISITOR_RETENTION_MONTHS} mois
 * plus tard par le même repli. Une visite refusée (opposition, GPC, DNT) n'arrive
 * jamais jusqu'ici : la route l'écarte avant tout calcul. Les
 * fenêtres glissantes se lisent sur le détail, les totaux « depuis toujours »
 * sur ces deux tables — si bien que la lecture ne grandit plus avec
 * l'historique : elle relisait toute la table, sept `COUNT(DISTINCT …)` à
 * chaque synchronisation.
 *
 * Vie privée : seule une empreinte SHA-256 salée est stockée
 * ({@link lib/shared/site-visits.visitorIdentitySource}) — jamais l'IP, ni le
 * user-agent, ni l'identifiant du compte. L'empreinte rend un visiteur unique
 * sans permettre de remonter à lui : le sel est un secret du serveur, absent de
 * la base comme de ses sauvegardes, si bien qu'une table lue ailleurs — une
 * archive restaurée, une copie volée — ne se rapproche d'aucune personne. Seul
 * un drapeau `authenticated` dit qu'une visite venait d'un compte connecté,
 * sans dire lequel.
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
  chargeRateLimit,
  checkRateLimit,
  resetRateLimit,
  type RateLimitRule,
} from "./rate-limit";
import {
  normalizeVisitPath,
  SITE_VISIT_DETAIL_RETENTION_DAYS,
  SITE_VISIT_WINDOW_MINUTES,
  SITE_VISITOR_RETENTION_MONTHS,
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
const VISIT_RATE_RULE: RateLimitRule = {
  name: "site-visits",
  limit: 30,
  windowMs: 60 * 1000,
  maxKeys: 10_000,
};

let lastBotSyncAt = 0;

/** Un agrégat SQL tel que `mysql2` le rend (nombre, chaîne pour un `BIGINT`, ou `NULL`). */
type SqlCount = number | string | null;
/** Une date SQL telle que `mysql2` la rend. */
type SqlDate = string | Date | null;

interface VisitStatsRow extends RowDataPacket {
  recent_visits: SqlCount;
  archived_visits: SqlCount;
  unique_visitors: SqlCount;
  identified_visitors: SqlCount;
  visits_24h: SqlCount;
  unique_24h: SqlCount;
  visits_7d: SqlCount;
  unique_7d: SqlCount;
  visits_30d: SqlCount;
  unique_30d: SqlCount;
  first_recent_visit_at: SqlDate;
  first_archived_visit_at: SqlDate;
  last_visit_at: SqlDate;
}

/**
 * Sel de hachage des empreintes. `VISIT_HASH_SALT` en priorité ; à défaut, le
 * secret interne déjà partagé avec le bot.
 *
 * **C'est le sel qui rend l'empreinte irréversible**, et non le hachage : un
 * identifiant de compte se devine en quelques milliers d'essais, une adresse
 * IPv4 en quatre milliards — un SHA-256 sans secret se renverse donc par simple
 * énumération. D'où le refus d'un sel connu en production : avec la constante de
 * repli, n'importe qui retrouverait qui a visité quoi. Rendre `null` fait
 * **renoncer à compter** (voir {@link recordSiteVisit}) plutôt que de compter
 * de façon réversible. Hors production (dev local, tests), la constante garde la
 * fonctionnalité utilisable.
 */
export function visitHashSalt(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.VISIT_HASH_SALT?.trim() || env.BOT_INTERNAL_TOKEN?.trim();
  if (secret) return secret;
  return env.NODE_ENV === "production" ? null : "bg-site-visits";
}

function hashVisitorIdentity(salt: string, source: string): string {
  return createHash("sha256").update(`${salt}:${source}`).digest("hex");
}

let missingSaltReported = false;

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
  return !checkRateLimit(VISIT_RATE_RULE, rateLimitKey(ip)).allowed;
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
  chargeRateLimit(VISIT_RATE_RULE, rateLimitKey(ip));
}

/** Vide le limiteur de débit (tests). */
export function resetVisitRateLimit(): void {
  resetRateLimit(VISIT_RATE_RULE.name);
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

  const salt = visitHashSalt();
  if (salt === null) {
    if (!missingSaltReported) {
      missingSaltReported = true;
      console.error(
        "[site-visits] Ni VISIT_HASH_SALT ni BOT_INTERNAL_TOKEN : les visites ne sont pas comptées " +
          "(une empreinte au sel connu se renverserait par énumération).",
      );
    }
    return { recorded: false };
  }

  const visitorKey = hashVisitorIdentity(salt, visitorIdentitySource(input));
  const path = normalizeVisitPath(input.path);
  // Le compte n'est **pas** écrit : seulement le fait qu'il y en avait un, pour
  // distinguer les visiteurs connectés dans les statistiques.
  const authenticated =
    typeof input.userId === "number" && Number.isInteger(input.userId) && input.userId > 0 ? 1 : 0;

  const db = await getDatabase();
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_site_visits (visitor_key, authenticated, path)
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
    [visitorKey, authenticated, path, visitorKey, SITE_VISIT_WINDOW_MINUTES],
  );

  const recorded = result.affectedRows > 0;
  if (recorded) {
    chargeVisitToRateLimit(input.ip);
    await rememberVisitor(visitorKey, authenticated);
  }

  return { recorded };
}

/**
 * Inscrit l'empreinte d'un visiteur à la liste des visiteurs uniques « depuis
 * toujours », que le repli du détail ne sait pas reconstituer (deux jours
 * repliés ne disent pas combien de visiteurs ils ont en commun).
 *
 * Meilleur effort : la visite est déjà comptée, et un échec ici ne doit pas la
 * faire passer pour perdue. `authenticated` ne redescend jamais — un visiteur
 * compté connecté une fois l'est pour le total, comme le
 * `COUNT(DISTINCT CASE WHEN authenticated = 1 …)` qu'il remplace.
 */
async function rememberVisitor(visitorKey: string, authenticated: number): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO bg_site_visitors (visitor_key, authenticated, last_seen_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         authenticated = GREATEST(bg_site_visitors.authenticated, VALUES(authenticated)),
         last_seen_at = GREATEST(bg_site_visitors.last_seen_at, VALUES(last_seen_at))`,
      [visitorKey, authenticated],
    );
  } catch (error) {
    console.error("[site-visits] Empreinte du visiteur non retenue pour le total.", error);
  }
}

/** Cadence de l'entretien des durées, indépendant de l'enregistrement d'une visite. */
const RETENTION_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
let lastRetentionMaintenanceAt = 0;

/**
 * Entretien des durées de conservation (détail à 31 jours, empreintes à
 * {@link SITE_VISITOR_RETENTION_MONTHS} mois), au plus une fois par heure.
 *
 * Le repli suit d'ordinaire la synchronisation vers le bot, qui ne part qu'après
 * une visite **enregistrée** : sans sel secret, ou quand tous les visiteurs
 * s'opposent à la mesure, rien ne s'enregistre plus et les durées annoncées
 * cesseraient d'être tenues. `/api/visits` l'appelle donc à chaque signalement,
 * refusé ou non — c'est de l'entretien, rien n'y concerne le visiteur —, et
 * `listTournamentBuckets` aussi, comme les autres purges : un visiteur opposé
 * dont le navigateur expose le signal n'envoie aucun signalement. Jamais
 * attendu, jamais levé.
 */
export function maintainSiteVisitRetention(now: number = Date.now()): void {
  if (now - lastRetentionMaintenanceAt < RETENTION_MAINTENANCE_INTERVAL_MS) return;
  lastRetentionMaintenanceAt = now;
  void rollUpExpiredSiteVisits().catch((error: unknown) => {
    console.error("[site-visits] Entretien des durées de conservation impossible.", error);
  });
}

/** Réinitialise la cadence de l'entretien des durées (tests). */
export function resetSiteVisitRetentionThrottle(): void {
  lastRetentionMaintenanceAt = 0;
}

/** Repli en cours, partagé par les appels concurrents. */
let pendingRollUp: Promise<number> | null = null;

/**
 * Replie les jours révolus du détail en compteurs journaliers, puis les efface.
 *
 * La borne est **un jour**, lue une fois et réutilisée par les deux écritures :
 * `NOW()` relu entre le report et l'effacement ferait effacer une visite qui
 * n'a pas été reportée. Un jour étant replié en entier ou pas du tout, aucune
 * journée n'est partagée entre le compteur et le détail. Les deux écritures
 * sont dans une transaction : un report sans effacement compterait deux fois.
 *
 * **Un seul repli à la fois** par processus : la cadence de synchronisation
 * n'est consommée qu'une fois la lecture faite, si bien que chaque visite
 * arrivée pendant un repli en relançait un — sur le premier passage après le
 * déploiement, qui replie des mois d'historique, ces transactions parallèles
 * verrouillaient les mêmes lignes et s'interbloquaient. Un appel concurrent
 * attend donc le repli en cours au lieu d'en ouvrir un second.
 *
 * @returns Le nombre de visites repliées.
 */
export function rollUpExpiredSiteVisits(): Promise<number> {
  if (pendingRollUp) return pendingRollUp;
  pendingRollUp = rollUpExpiredSiteVisitsNow().finally(() => {
    pendingRollUp = null;
  });
  return pendingRollUp;
}

async function rollUpExpiredSiteVisitsNow(): Promise<number> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    const [bounds] = await connection.execute<(RowDataPacket & { cutoff: string | null })[]>(
      `SELECT DATE_FORMAT(CURDATE() - INTERVAL ? DAY, '%Y-%m-%d') AS cutoff`,
      [SITE_VISIT_DETAIL_RETENTION_DAYS],
    );
    const cutoff = bounds[0]?.cutoff;
    if (!cutoff) return 0;

    await connection.beginTransaction();
    try {
      // Aucune ligne ne part sans que son empreinte soit au total des visiteurs
      // uniques : `rememberVisitor` peut avoir échoué, ou la reprise du
      // démarrage (`database.ts`) ne pas avoir abouti — sans ce report, ces
      // visiteurs disparaîtraient du total avec leur détail, pour toujours.
      await connection.execute(
        `INSERT INTO bg_site_visitors (visitor_key, authenticated, last_seen_at)
         SELECT visitor_key, MAX(authenticated), MAX(created_at)
         FROM bg_site_visits
         WHERE created_at < ?
         GROUP BY visitor_key
         ON DUPLICATE KEY UPDATE
           authenticated = GREATEST(bg_site_visitors.authenticated, VALUES(authenticated)),
           last_seen_at = GREATEST(bg_site_visitors.last_seen_at, VALUES(last_seen_at))`,
        [cutoff],
      );
      // Empreintes au-delà de leur durée de conservation, comptée depuis la
      // dernière visite. Une empreinte encore présente au détail n'est jamais
      // effacée : le report ci-dessus ne rajeunit que les jours repliés, et
      // `rememberVisitor` (meilleur effort) a pu manquer une visite récente.
      await connection.execute(
        `DELETE FROM bg_site_visitors
         WHERE last_seen_at < NOW() - INTERVAL ? MONTH
           AND NOT EXISTS (
             SELECT 1 FROM bg_site_visits v WHERE v.visitor_key = bg_site_visitors.visitor_key
           )`,
        [SITE_VISITOR_RETENTION_MONTHS],
      );
      await connection.execute(
        `INSERT INTO bg_site_visit_days (day, visits, first_visit_at)
         SELECT DATE(created_at), COUNT(*), MIN(created_at)
         FROM bg_site_visits
         WHERE created_at < ?
         GROUP BY DATE(created_at)
         ON DUPLICATE KEY UPDATE
           visits = bg_site_visit_days.visits + VALUES(visits),
           first_visit_at = LEAST(bg_site_visit_days.first_visit_at, VALUES(first_visit_at))`,
        [cutoff],
      );
      const [deleted] = await connection.execute<ResultSetHeader>(
        `DELETE FROM bg_site_visits WHERE created_at < ?`,
        [cutoff],
      );
      await connection.commit();
      return deleted.affectedRows;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    }
  } finally {
    connection.release();
  }
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
    // Le détail ne couvre que les derniers jours (repli ci-dessus) : c'est lui
    // qu'on balaie, pour les fenêtres glissantes et les visites pas encore
    // repliées. Les totaux « depuis toujours » viennent des deux tables de
    // cumul, par des sous-requêtes sur leur clé.
    const [rows] = await db.execute<VisitStatsRow[]>(
      `SELECT
         COUNT(*) AS recent_visits,
         (SELECT COALESCE(SUM(visits), 0) FROM bg_site_visit_days) AS archived_visits,
         (SELECT COUNT(*) FROM bg_site_visitors) AS unique_visitors,
         (SELECT COUNT(*) FROM bg_site_visitors WHERE authenticated = 1) AS identified_visitors,
         SUM(created_at >= NOW() - INTERVAL 1 DAY) AS visits_24h,
         COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL 1 DAY THEN visitor_key END) AS unique_24h,
         SUM(created_at >= NOW() - INTERVAL 7 DAY) AS visits_7d,
         COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL 7 DAY THEN visitor_key END) AS unique_7d,
         SUM(created_at >= NOW() - INTERVAL 30 DAY) AS visits_30d,
         COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL 30 DAY THEN visitor_key END) AS unique_30d,
         MIN(created_at) AS first_recent_visit_at,
         (SELECT MIN(first_visit_at) FROM bg_site_visit_days) AS first_archived_visit_at,
         MAX(created_at) AS last_visit_at
       FROM bg_site_visits`,
    );

    const row = rows[0];
    if (!row) return emptySiteVisitStats();

    return {
      totalVisits: count(row.archived_visits) + count(row.recent_visits),
      uniqueVisitors: count(row.unique_visitors),
      visitsLast24h: count(row.visits_24h),
      uniqueVisitorsLast24h: count(row.unique_24h),
      visitsLast7Days: count(row.visits_7d),
      uniqueVisitorsLast7Days: count(row.unique_7d),
      visitsLast30Days: count(row.visits_30d),
      uniqueVisitorsLast30Days: count(row.unique_30d),
      identifiedVisitors: count(row.identified_visitors),
      // Un jour replié est toujours antérieur au détail restant.
      firstVisitAt: toIso(
        (row.first_archived_visit_at ?? row.first_recent_visit_at) as string | null,
      ),
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

  // Le repli suit la cadence de la synchronisation : au plus une fois toutes
  // les cinq minutes, et seulement quand des visites arrivent. Son échec ne
  // prive pas le bot de ses chiffres — le détail restant est simplement plus
  // long, et le prochain passage repliera.
  await rollUpExpiredSiteVisits().catch((error: unknown) => {
    console.error("[site-visits] Repli des visites anciennes impossible.", error);
  });

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
