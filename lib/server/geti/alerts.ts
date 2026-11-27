/**
 * Alertes sur une recherche d'annonces GETI (`bg_geti_alerts`) —
 * `docs/features/GETI_INFO.md` § Alertes.
 *
 * Un compte connecté garde la catégorie et les filtres qu'il regarde ; à
 * chaque lot d'annonces poussé par le bot, les annonces **récentes** sont
 * confrontées aux alertes actives de leur catégorie, et le propriétaire d'une
 * alerte touchée est prévenu par `notifyUsers` (push sur ses appareils,
 * message privé Discord si son compte Discord est certifié).
 *
 * Module serveur.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import type { GetiExecutor } from "@/lib/server/geti/posts";
import { isMissingTableError, rowsOrEmptyIfMissingTable } from "@/lib/server/mysql-errors";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { toIso } from "@/lib/server/serialization";
import { siteCanonicalBase } from "@/lib/server/site-url";
import { GETI_CATEGORIES, type GetiCategory, type GetiFilter, type GetiParsedPost } from "@/lib/shared/geti";
import {
  GETI_ALERT_COOLDOWN_MINUTES,
  GETI_ALERT_ERRORS,
  GETI_ALERT_HIT_RETENTION_DAYS,
  GETI_ALERT_MAX_PER_USER,
  GETI_ALERT_SCAN_MAX,
  getiAlertName,
  getiAlertSearch,
  isFreshGetiPost,
  matchingGetiAlerts,
  type GetiAlert,
} from "@/lib/shared/geti/alerts";
import { getiAlertDm, getiAlertPush } from "@/lib/shared/push-messages";

type AlertRow = RowDataPacket & {
  id: number;
  user_id: number;
  category: string;
  name: string | null;
  search: string;
  paused: number;
  created_at: Date | string;
};

function affected(result: unknown): number {
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

function isCategory(value: unknown): value is GetiCategory {
  return GETI_CATEGORIES.some((category) => category === value);
}

function alertOf(row: AlertRow): GetiAlert | null {
  if (!isCategory(row.category)) return null;
  return {
    id: Number(row.id),
    category: row.category,
    name: row.name,
    search: row.search,
    paused: Boolean(row.paused),
    createdAt: toIso(row.created_at) ?? "",
  };
}

const ALERT_COLUMNS = "id, user_id, category, name, search, paused, created_at";

/** Les alertes d'un compte, de la plus ancienne à la plus récente. Table absente : aucune. */
export async function listGetiAlerts(userId: number, executor?: GetiExecutor): Promise<GetiAlert[]> {
  const db = executor ?? (await getDatabase());
  const rows = await rowsOrEmptyIfMissingTable(
    db.execute<AlertRow[]>(`SELECT ${ALERT_COLUMNS} FROM bg_geti_alerts WHERE user_id = ? ORDER BY id`, [userId]),
  );
  return rows.map(alertOf).filter((alert): alert is GetiAlert => alert !== null);
}

/** Ce qu'une route reçoit pour créer une alerte. */
export type GetiAlertInput = { category?: unknown; search?: unknown; name?: unknown };

/** Une alerte créée ou changée, ou le code du refus. */
export type GetiAlertResult = GetiAlert | string;

async function inTransaction<T>(run: (connection: PoolConnection) => Promise<T>): Promise<T> {
  return withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const result = await run(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Crée une alerte pour la catégorie et la recherche données. Le plafond par
 * compte et le refus d'un doublon se jouent sous le verrou de la ligne du
 * compte (première instruction, requête sans jointure) : deux créations
 * simultanées ne peuvent pas dépasser le plafond.
 */
export async function createGetiAlert(userId: number, input: GetiAlertInput): Promise<GetiAlertResult> {
  if (!isCategory(input.category) || typeof input.search !== "string") return GETI_ALERT_ERRORS.invalid;
  const category = input.category;
  const search = getiAlertSearch(category, input.search);
  if (search === null) return GETI_ALERT_ERRORS.invalid;
  const name = getiAlertName(input.name);
  if (name === undefined) return GETI_ALERT_ERRORS.nameTooLong;

  return inTransaction(async (connection) => {
    await connection.execute(`SELECT id FROM bg_users WHERE id = ? FOR UPDATE`, [userId]);
    const [rows] = await connection.execute<AlertRow[]>(
      `SELECT ${ALERT_COLUMNS} FROM bg_geti_alerts WHERE user_id = ? ORDER BY id`,
      [userId],
    );
    if (rows.some((row) => row.category === category && row.search === search)) return GETI_ALERT_ERRORS.duplicate;
    if (rows.length >= GETI_ALERT_MAX_PER_USER) return GETI_ALERT_ERRORS.limit;
    const [result] = await connection.execute(
      `INSERT INTO bg_geti_alerts (user_id, category, name, search) VALUES (?, ?, ?, ?)`,
      [userId, category, name, search],
    );
    const id = Number((result as { insertId?: number }).insertId ?? 0);
    return { id, category, name, search, paused: false, createdAt: new Date().toISOString() };
  });
}

/** Ce qu'une route reçoit pour changer une alerte : son nom, sa pause, ou les deux. */
export type GetiAlertPatch = { name?: unknown; paused?: unknown };

/** Renomme, met en pause ou relance une alerte du compte. */
export async function updateGetiAlert(userId: number, alertId: number, patch: GetiAlertPatch): Promise<GetiAlertResult> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if ("name" in patch) {
    const name = getiAlertName(patch.name);
    if (name === undefined) return GETI_ALERT_ERRORS.nameTooLong;
    sets.push("name = ?");
    params.push(name);
  }
  if ("paused" in patch) {
    if (typeof patch.paused !== "boolean") return GETI_ALERT_ERRORS.invalid;
    sets.push("paused = ?");
    params.push(patch.paused ? 1 : 0);
  }
  if (sets.length === 0) return GETI_ALERT_ERRORS.invalid;
  const db = await getDatabase();
  await db.execute(`UPDATE bg_geti_alerts SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, [
    ...params,
    alertId,
    userId,
  ]);
  // Relue plutôt que jugée sur `affectedRows` : un changement sans effet (même nom) n'est pas un refus.
  const [rows] = await db.execute<AlertRow[]>(
    `SELECT ${ALERT_COLUMNS} FROM bg_geti_alerts WHERE id = ? AND user_id = ?`,
    [alertId, userId],
  );
  const alert = rows[0] ? alertOf(rows[0]) : null;
  return alert ?? GETI_ALERT_ERRORS.notFound;
}

/** Supprime une alerte du compte (et ses traces d'annonces vues) ; `false` si elle n'est pas à lui. */
export async function deleteGetiAlert(userId: number, alertId: number): Promise<boolean> {
  const db = await getDatabase();
  const [result] = await db.execute(`DELETE FROM bg_geti_alerts WHERE id = ? AND user_id = ?`, [alertId, userId]);
  if (affected(result) === 0) return false;
  await db.execute(`DELETE FROM bg_geti_alert_hits WHERE alert_id = ?`, [alertId]);
  return true;
}

/**
 * Efface toutes les alertes d'un compte (effacement du compte). Tables
 * absentes : rien à effacer.
 */
export async function deleteGetiAlertsOfUser(executor: GetiExecutor, userId: number): Promise<void> {
  try {
    await executor.execute(
      `DELETE FROM bg_geti_alert_hits WHERE alert_id IN (SELECT id FROM bg_geti_alerts WHERE user_id = ?)`,
      [userId],
    );
    await executor.execute(`DELETE FROM bg_geti_alerts WHERE user_id = ?`, [userId]);
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
  }
}

/** Les alertes d'un compte, pour l'export de ses données. */
export async function exportGetiAlerts(
  userId: number,
): Promise<{ category: string; name: string | null; search: string; paused: boolean; createdAt: string }[]> {
  return (await listGetiAlerts(userId)).map(({ category, name, search, paused, createdAt }) => ({
    category,
    name,
    search,
    paused,
    createdAt,
  }));
}

/** Retire les traces d'annonces vues plus vieilles que la garde ; rend le nombre de lignes retirées. */
export async function purgeGetiAlertHits(executor: GetiExecutor, now: number = Date.now()): Promise<number> {
  try {
    const [result] = await executor.execute(`DELETE FROM bg_geti_alert_hits WHERE created_at < ?`, [
      new Date(now - GETI_ALERT_HIT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    ]);
    return affected(result);
  } catch (error) {
    if (isMissingTableError(error)) return 0;
    throw error;
  }
}

/** Une annonce qui vient d'être enregistrée, telle que la correspondance la lit. */
export type GetiAlertPost = {
  messageId: string;
  category: GetiCategory;
  parsed: GetiParsedPost;
  postedAt: Date;
  editedAt: Date | null;
};

type ActiveAlertRow = RowDataPacket & {
  id: number;
  user_id: number;
  category: string;
  name: string | null;
  search: string;
};
/** Une alerte active, telle que la passe d'alertes la lit. */
export type ActiveAlert = { id: number; userId: number; category: GetiCategory; name: string | null; search: string };

/** L'envoi d'une alerte touchée ; `true` si un compte joignable a été prévenu. Remplaçable (tests, seed). */
export type GetiAlertSender = (alert: ActiveAlert, post: GetiAlertPost) => Promise<boolean>;

/** Bilan d'une passe d'alertes : des nombres seulement. */
export type GetiAlertOutcome = {
  /** Couples (alerte, annonce) nouvellement touchés. */
  matched: number;
  /** Comptes prévenus. */
  notified: number;
};

async function loadActiveAlerts(db: GetiExecutor, categories: readonly GetiCategory[]): Promise<ActiveAlert[]> {
  // `LIMIT` écrit en dur (constante entière), comme `listGetiPosts`.
  const [rows] = await db.execute<ActiveAlertRow[]>(
    `SELECT id, user_id, category, name, search
       FROM bg_geti_alerts
      WHERE paused = 0 AND category IN (${categories.map(() => "?").join(", ")})
      ORDER BY id
      LIMIT ${GETI_ALERT_SCAN_MAX}`,
    [...categories],
  );
  const alerts: ActiveAlert[] = [];
  for (const row of rows) {
    if (!isCategory(row.category)) continue;
    alerts.push({
      id: Number(row.id),
      userId: Number(row.user_id),
      category: row.category,
      name: row.name,
      search: row.search,
    });
  }
  return alerts;
}

/** Prévient le propriétaire d'une alerte ; `true` si l'envoi a été tenté vers un compte joignable. */
async function sendAlert(alert: ActiveAlert, post: GetiAlertPost): Promise<boolean> {
  // Compte Discord **certifié** seulement ; un compte suspendu garde ses alertes mais n'est plus prévenu.
  const recipients = await loadNotificationRecipients([alert.userId], "certified", { excludeSuspended: true });
  if (recipients.length === 0) return false;
  const siteBase = siteCanonicalBase();
  const notice = {
    alertId: alert.id,
    category: alert.category,
    name: alert.name,
    search: alert.search,
    messageId: post.messageId,
  };
  await notifyUsers(recipients, {
    topic: "GETI_ALERT",
    push: (locale) => getiAlertPush(notice, locale),
    discord: { message: (locale) => getiAlertDm(notice, siteBase, locale), context: "geti-alert" },
    dmFollowsTopic: true,
  });
  return true;
}

type AlertHit = { alert: ActiveAlert; post: GetiAlertPost };

/**
 * Pose la trace de chaque couple (alerte, annonce) qui correspond ; rend, par
 * alerte, la première annonce **nouvellement** vue (`affectedRows` de
 * l'`INSERT IGNORE`), et compte les couples neufs dans `outcome.matched`.
 */
async function recordAlertHits(
  db: GetiExecutor,
  posts: readonly GetiAlertPost[],
  alerts: readonly ActiveAlert[],
  now: number,
  outcome: GetiAlertOutcome,
): Promise<AlertHit[]> {
  const filters = new Map<number, GetiFilter>();
  const firstHit = new Map<number, AlertHit>();
  for (const post of posts) {
    for (const alert of matchingGetiAlerts(post.parsed, post.category, alerts, filters, now)) {
      const [result] = await db.execute(
        `INSERT IGNORE INTO bg_geti_alert_hits (alert_id, message_id, created_at) VALUES (?, ?, ?)`,
        [alert.id, post.messageId, new Date(now)],
      );
      if (affected(result) === 0) continue;
      outcome.matched += 1;
      if (!firstHit.has(alert.id)) firstHit.set(alert.id, { alert, post });
    }
  }
  return [...firstHit.values()];
}

/**
 * Réserve le délai de chaque alerte touchée (une instruction, `affectedRows`)
 * et prévient son compte — un seul envoi par compte ; rend le nombre de
 * comptes prévenus. Un envoi qui échoue n'arrête pas les suivants.
 */
async function sendReservedAlerts(
  db: GetiExecutor,
  hits: readonly AlertHit[],
  now: number,
  send: GetiAlertSender,
): Promise<number> {
  const cooledBefore = new Date(now - GETI_ALERT_COOLDOWN_MINUTES * 60_000);
  const notifiedUsers = new Set<number>();
  let notified = 0;
  for (const { alert, post } of hits) {
    if (notifiedUsers.has(alert.userId)) continue;
    const [reserved] = await db.execute(
      `UPDATE bg_geti_alerts SET last_notified_at = ?
        WHERE id = ? AND paused = 0 AND (last_notified_at IS NULL OR last_notified_at <= ?)`,
      [new Date(now), alert.id, cooledBefore],
    );
    if (affected(reserved) === 0) continue;
    notifiedUsers.add(alert.userId);
    try {
      if (await send(alert, post)) notified += 1;
    } catch (error) {
      console.error("[geti] alerte non remise", failureReason(error));
    }
  }
  return notified;
}

/**
 * Confronte les annonces d'un lot aux alertes actives et prévient leurs
 * propriétaires.
 *
 * - Seules les annonces **récentes** et **ouvertes** comptent
 *   (`isFreshGetiPost`) : le rattrapage du bot ne prévient personne.
 * - Une alerte ne voit une annonce qu'**une fois** : la trace
 *   `bg_geti_alert_hits` (clé alerte + message) se pose par `INSERT IGNORE`,
 *   et seule l'insertion qui la crée compte — une modification, un second
 *   rattrapage ou un envoi en double ne préviennent pas de nouveau.
 * - Au plus une notification par alerte toutes les
 *   `GETI_ALERT_COOLDOWN_MINUTES`, réservée en une instruction
 *   (`UPDATE … WHERE last_notified_at …` + `affectedRows`), et une seule par
 *   compte et par lot.
 *
 * Coût : une lecture des alertes actives des catégories du lot (au plus
 * `GETI_ALERT_SCAN_MAX` lignes), puis `annonces récentes × alertes de la
 * catégorie` correspondances en mémoire (lot de vingt annonces au plus), le
 * filtre de chaque alerte n'étant construit qu'une fois.
 *
 * Ne lève jamais : une panne (table absente, bot injoignable, push refusé) ne
 * doit pas faire échouer l'enregistrement des annonces.
 */
export async function notifyGetiAlerts(
  posts: readonly GetiAlertPost[],
  now: number = Date.now(),
  executor?: GetiExecutor,
  send: GetiAlertSender = sendAlert,
): Promise<GetiAlertOutcome> {
  const outcome: GetiAlertOutcome = { matched: 0, notified: 0 };
  try {
    const fresh = posts.filter(
      (post) => !post.parsed.closed && isFreshGetiPost(post.postedAt.getTime(), post.editedAt?.getTime() ?? null, now),
    );
    if (fresh.length === 0) return outcome;
    const db = executor ?? (await getDatabase());
    const alerts = await loadActiveAlerts(db, [...new Set(fresh.map((post) => post.category))]);
    if (alerts.length === 0) return outcome;

    const firstHits = await recordAlertHits(db, fresh, alerts, now, outcome);
    outcome.notified = await sendReservedAlerts(db, firstHits, now, send);
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[geti] passe d'alertes impossible", failureReason(error));
  }
  return outcome;
}
