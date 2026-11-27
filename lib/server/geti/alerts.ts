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
import { readStoredGetiPosts, type GetiExecutor } from "@/lib/server/geti/posts";
import { ignoreMissingTable, isMissingTableError, rowsOrEmptyIfMissingTable } from "@/lib/server/mysql-errors";
import { loadNotificationRecipients, notifyUsers, type NotificationRecipient } from "@/lib/server/notify";
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
import type { PersonalDataExport } from "@/lib/shared/types";

/** Une alerte telle que l'export la rend : tout ce que sa ligne et ses traces gardent. */
export type GetiAlertExport = PersonalDataExport["getiAlerts"][number];

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
  // Chaque table a sa garde : les deux se créent séparément (`schema/geti.ts`),
  // une table de traces absente ne doit pas laisser les alertes en place.
  await ignoreMissingTable(
    executor.execute(
      `DELETE FROM bg_geti_alert_hits WHERE alert_id IN (SELECT id FROM bg_geti_alerts WHERE user_id = ?)`,
      [userId],
    ),
  );
  await ignoreMissingTable(executor.execute(`DELETE FROM bg_geti_alerts WHERE user_id = ?`, [userId]));
}

type ExportAlertRow = AlertRow & { last_notified_at: Date | string | null };
type ExportHitRow = RowDataPacket & { alert_id: number; message_id: string; created_at: Date | string };

/** Les alertes d'un compte et leurs traces, pour l'export de ses données. Tables absentes : rien. */
export async function exportGetiAlerts(userId: number, executor?: GetiExecutor): Promise<GetiAlertExport[]> {
  const db = executor ?? (await getDatabase());
  const alerts = await rowsOrEmptyIfMissingTable(
    db.execute<ExportAlertRow[]>(
      `SELECT ${ALERT_COLUMNS}, last_notified_at FROM bg_geti_alerts WHERE user_id = ? ORDER BY id`,
      [userId],
    ),
  );
  if (alerts.length === 0) return [];
  const hits = await rowsOrEmptyIfMissingTable(
    db.execute<ExportHitRow[]>(
      `SELECT h.alert_id, h.message_id, h.created_at
         FROM bg_geti_alert_hits h
         JOIN bg_geti_alerts a ON a.id = h.alert_id
        WHERE a.user_id = ?
        ORDER BY h.alert_id, h.created_at`,
      [userId],
    ),
  );
  return alerts.map((row) => ({
    category: row.category,
    name: row.name,
    search: row.search,
    paused: Boolean(row.paused),
    createdAt: toIso(row.created_at) ?? "",
    lastNotifiedAt: toIso(row.last_notified_at),
    reportedPosts: hits
      .filter((hit) => Number(hit.alert_id) === Number(row.id))
      .map((hit) => ({ messageId: String(hit.message_id), createdAt: toIso(hit.created_at) ?? "" })),
  }));
}

/** Traces effacées par instruction de la purge, et passages au plus (le reste attend l'heure suivante). */
const HIT_PURGE_BATCH = 5000;
const HIT_PURGE_MAX_BATCHES = 100;

/**
 * Retire les traces d'annonces vues plus vieilles que la garde ; rend le
 * nombre de lignes retirées. Par lots : une table qui a grossi (jusqu'à
 * `GETI_ALERT_SCAN_MAX` traces par annonce reçue) ne tient ni ses verrous ni
 * le journal binaire en une seule instruction.
 */
export async function purgeGetiAlertHits(executor: GetiExecutor, now: number = Date.now()): Promise<number> {
  const before = new Date(now - GETI_ALERT_HIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let removed = 0;
  try {
    for (let pass = 0; pass < HIT_PURGE_MAX_BATCHES; pass += 1) {
      const [result] = await executor.execute(
        `DELETE FROM bg_geti_alert_hits WHERE created_at < ? LIMIT ${HIT_PURGE_BATCH}`,
        [before],
      );
      const count = affected(result);
      removed += count;
      if (count < HIT_PURGE_BATCH) break;
    }
  } catch (error) {
    if (isMissingTableError(error)) return removed;
    throw error;
  }
  return removed;
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
  last_notified_at: Date | string | null;
  discord_id: string | null;
};
/**
 * Une alerte active, telle que la passe d'alertes la lit : avec la date de sa
 * dernière notification (rendue si l'envoi ne joint personne) et l'identifiant
 * Discord de son compte (sa propre annonce ne le prévient pas).
 */
export type ActiveAlert = {
  id: number;
  userId: number;
  category: GetiCategory;
  name: string | null;
  search: string;
  lastNotifiedAt: Date | null;
  ownerDiscordId: string | null;
};

/** L'envoi d'une alerte touchée ; `true` si un compte joignable a été prévenu. Remplaçable (tests, seed). */
export type GetiAlertSender = (alert: ActiveAlert, post: GetiAlertPost) => Promise<boolean>;

/** Bilan d'une passe d'alertes : des nombres seulement. */
export type GetiAlertOutcome = {
  /** Couples (alerte, annonce) nouvellement touchés. */
  matched: number;
  /** Comptes prévenus. */
  notified: number;
};

/**
 * Les alertes actives d'une catégorie, au plus `GETI_ALERT_SCAN_MAX`, dans
 * l'ordre de leur identifiant. Une requête par catégorie : `(category, paused)`
 * porte déjà l'identifiant, la lecture suit l'index sans tri (un `IN` sur
 * plusieurs catégories trierait toutes les alertes actives avant de couper).
 */
async function loadActiveAlertsOf(db: GetiExecutor, category: GetiCategory): Promise<ActiveAlert[]> {
  // `LIMIT` écrit en dur (constante entière), comme `listGetiPosts`.
  const [rows] = await db.execute<ActiveAlertRow[]>(
    `SELECT a.id, a.user_id, a.category, a.name, a.search, a.last_notified_at, u.discord_id
       FROM bg_geti_alerts a
       JOIN bg_users u ON u.id = a.user_id
      WHERE a.paused = 0 AND a.category = ?
      ORDER BY a.id
      LIMIT ${GETI_ALERT_SCAN_MAX + 1}`,
    [category],
  );
  // Une ligne de plus que la borne : seule elle dit que des alertes restent non lues — signalé dans pm2 (un nombre seul).
  if (rows.length > GETI_ALERT_SCAN_MAX) console.warn("[geti] borne des alertes lues atteinte:", GETI_ALERT_SCAN_MAX);
  const alerts: ActiveAlert[] = [];
  for (const row of rows.slice(0, GETI_ALERT_SCAN_MAX)) {
    if (!isCategory(row.category)) continue;
    const lastNotifiedAt = toIso(row.last_notified_at);
    alerts.push({
      id: Number(row.id),
      userId: Number(row.user_id),
      category: row.category,
      name: row.name,
      search: row.search,
      lastNotifiedAt: lastNotifiedAt === null ? null : new Date(lastNotifiedAt),
      ownerDiscordId: row.discord_id === null ? null : String(row.discord_id),
    });
  }
  return alerts;
}

async function loadActiveAlerts(db: GetiExecutor, categories: readonly GetiCategory[]): Promise<ActiveAlert[]> {
  const alerts: ActiveAlert[] = [];
  for (const category of categories) alerts.push(...(await loadActiveAlertsOf(db, category)));
  return alerts;
}

/**
 * La version **gardée** des annonces reçues : celle que l'enregistrement a
 * retenue (une version plus ancienne arrivée après une modification ne
 * remplace rien), lue comme la page la lit (`readStoredGetiPosts` : une
 * analyse ancienne est réanalysée) ; une annonce retirée entre-temps n'est
 * plus là.
 */
async function loadStoredVersions(
  db: GetiExecutor,
  posts: readonly GetiAlertPost[],
  now: number,
): Promise<GetiAlertPost[]> {
  const stored = await readStoredGetiPosts(
    db,
    posts.map((post) => post.messageId),
    now,
  );
  return stored.map((post) => ({
    messageId: post.messageId,
    category: post.category,
    parsed: post.parsed,
    postedAt: new Date(post.postedAt),
    editedAt: post.editedAt === null ? null : new Date(post.editedAt),
  }));
}

/** Une annonce ouverte, publiée ou modifiée récemment : la seule qui prévient. */
function isAlertable(post: GetiAlertPost, now: number): boolean {
  return !post.parsed.closed && isFreshGetiPost(post.postedAt.getTime(), post.editedAt?.getTime() ?? null, now);
}

/** L'auteur de l'annonce est le propriétaire de l'alerte (même compte Discord) : il n'est pas prévenu. */
function isOwnPost(alert: ActiveAlert, post: GetiAlertPost): boolean {
  return alert.ownerDiscordId !== null && post.parsed.authorId === alert.ownerDiscordId;
}

/** Comptes lus par requête `IN (…)` pour les destinataires d'une passe. */
const RECIPIENT_CHUNK = 500;

/**
 * L'envoi par défaut d'une passe : les destinataires de **tous** les comptes à
 * prévenir se lisent en quelques requêtes, à la première alerte envoyée
 * (compte Discord **certifié** seulement ; un compte suspendu garde ses alertes
 * mais n'est plus prévenu), au lieu d'une lecture par alerte. Chaque alerte part
 * ensuite par `notifyUsers` (son lien et son nom lui sont propres).
 */
function recipientSender(userIds: readonly number[]): GetiAlertSender {
  const siteBase = siteCanonicalBase();
  let loaded: Promise<Map<number, NotificationRecipient>> | null = null;
  const load = async (): Promise<Map<number, NotificationRecipient>> => {
    const recipients = new Map<number, NotificationRecipient>();
    for (let start = 0; start < userIds.length; start += RECIPIENT_CHUNK) {
      const chunk = userIds.slice(start, start + RECIPIENT_CHUNK);
      for (const recipient of await loadNotificationRecipients(chunk, "certified", { excludeSuspended: true })) {
        recipients.set(recipient.userId, recipient);
      }
    }
    return recipients;
  };
  return async (alert, post) => {
    loaded ??= load();
    const recipient = (await loaded).get(alert.userId);
    if (recipient === undefined) return false;
    const notice = {
      alertId: alert.id,
      category: alert.category,
      name: alert.name,
      search: alert.search,
      messageId: post.messageId,
    };
    await notifyUsers([recipient], {
      topic: "GETI_ALERT",
      push: (locale) => getiAlertPush(notice, locale),
      discord: { message: (locale) => getiAlertDm(notice, siteBase, locale), context: "geti-alert" },
      dmFollowsTopic: true,
    });
    return true;
  };
}

/** Une alerte déjà dans son délai, telle que la lecture l'a vue : rien à réserver, aucune écriture. */
function isCoolingDown(alert: ActiveAlert, cooledBefore: Date): boolean {
  return alert.lastNotifiedAt !== null && alert.lastNotifiedAt.getTime() > cooledBefore.getTime();
}

/**
 * Une alerte touchée : la première annonce nouvellement vue (celle envoyée) et
 * toutes les annonces dont cette passe a posé la trace (rendues si l'envoi ne
 * joint personne).
 */
type AlertHit = { alert: ActiveAlert; post: GetiAlertPost; messageIds: string[] };

/**
 * Pose la trace de chaque couple (alerte, annonce) qui correspond ; rend, par
 * alerte, la première annonce **nouvellement** vue (trace posée par cette
 * passe) et la liste de ses annonces neuves, et compte les couples neufs dans
 * `outcome.matched`.
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
    const matched = matchingGetiAlerts(post.parsed, post.category, alerts, filters, now).filter(
      (alert) => !isOwnPost(alert, post),
    );
    for (let start = 0; start < matched.length; start += HIT_CHUNK) {
      for (const alert of await insertNewHits(db, post, matched.slice(start, start + HIT_CHUNK), now)) {
        outcome.matched += 1;
        const hit = firstHit.get(alert.id);
        if (hit) hit.messageIds.push(post.messageId);
        else firstHit.set(alert.id, { alert, post, messageIds: [post.messageId] });
      }
    }
  }
  return [...firstHit.values()];
}

/** Alertes lues et traces posées par instruction, pour une annonce. */
const HIT_CHUNK = 500;

/**
 * Pose en une instruction les traces (alerte, annonce) qui n'existent pas
 * encore et rend les alertes dont **cette** passe a posé la trace. Une passe
 * simultanée qui a posé les mêmes traces entre la lecture et l'écriture
 * (`affectedRows` nul) ne prévient pas une seconde fois ; sur un recouvrement
 * partiel (`affectedRows` plus petit que les traces écrites), seules les
 * traces portant la date de cette passe comptent — deux passes de la même
 * seconde restent bornées par le délai de chaque alerte.
 */
async function insertNewHits(
  db: GetiExecutor,
  post: GetiAlertPost,
  alerts: readonly ActiveAlert[],
  now: number,
): Promise<ActiveAlert[]> {
  if (alerts.length === 0) return [];
  const [seen] = await db.execute<(RowDataPacket & { alert_id: number })[]>(
    `SELECT alert_id FROM bg_geti_alert_hits WHERE message_id = ? AND alert_id IN (${alerts.map(() => "?").join(", ")})`,
    [post.messageId, ...alerts.map((alert) => alert.id)],
  );
  const seenIds = new Set(seen.map((row) => Number(row.alert_id)));
  const unseen = alerts.filter((alert) => !seenIds.has(alert.id));
  if (unseen.length === 0) return [];
  // À la seconde : la colonne `DATETIME` n'en garde pas moins, et la relecture d'un recouvrement compare cette valeur.
  const at = new Date(Math.floor(now / 1000) * 1000);
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_geti_alert_hits (alert_id, message_id, created_at) VALUES ${unseen.map(() => "(?, ?, ?)").join(", ")}`,
    unseen.flatMap((alert) => [alert.id, post.messageId, at]),
  );
  const inserted = affected(result);
  if (inserted === 0) return [];
  if (inserted === unseen.length) return unseen;
  const [mine] = await db.execute<(RowDataPacket & { alert_id: number })[]>(
    `SELECT alert_id FROM bg_geti_alert_hits
      WHERE message_id = ? AND created_at = ? AND alert_id IN (${unseen.map(() => "?").join(", ")})`,
    [post.messageId, at, ...unseen.map((alert) => alert.id)],
  );
  const mineIds = new Set(mine.map((row) => Number(row.alert_id)));
  return unseen.filter((alert) => mineIds.has(alert.id));
}

/**
 * Un envoi qui n'a joint personne (compte suspendu ou effacé, panne) rend le
 * délai réservé — seulement s'il n'a pas été repris entre-temps — et retire
 * les traces que cette passe a posées pour l'alerte (toutes ses annonces du
 * lot, pas seulement celle envoyée) : une modification récente pourra encore
 * prévenir.
 */
async function releaseReservation(db: GetiExecutor, hit: AlertHit, reservedAt: Date): Promise<void> {
  try {
    await db.execute(`UPDATE bg_geti_alerts SET last_notified_at = ? WHERE id = ? AND last_notified_at = ?`, [
      hit.alert.lastNotifiedAt,
      hit.alert.id,
      reservedAt,
    ]);
    for (let start = 0; start < hit.messageIds.length; start += HIT_CHUNK) {
      const chunk = hit.messageIds.slice(start, start + HIT_CHUNK);
      await db.execute(
        `DELETE FROM bg_geti_alert_hits WHERE alert_id = ? AND message_id IN (${chunk.map(() => "?").join(", ")})`,
        [hit.alert.id, ...chunk],
      );
    }
  } catch (error) {
    console.error("[geti] délai d'alerte non rendu", failureReason(error));
  }
}

/** Les comptes dont une alerte touchée peut encore partir : les seuls dont le destinataire se lit. */
function usersToNotify(hits: readonly AlertHit[], now: number): number[] {
  const cooledBefore = new Date(now - GETI_ALERT_COOLDOWN_MINUTES * 60_000);
  return [...new Set(hits.filter((hit) => !isCoolingDown(hit.alert, cooledBefore)).map((hit) => hit.alert.userId))];
}

/**
 * Réserve le délai de chaque alerte touchée (une instruction, `affectedRows`)
 * et prévient son compte — un seul envoi réussi par compte ; rend le nombre de
 * comptes prévenus. Un envoi qui échoue n'arrête pas les suivants et rend sa
 * réservation.
 */
async function sendReservedAlerts(
  db: GetiExecutor,
  hits: readonly AlertHit[],
  now: number,
  send: GetiAlertSender,
): Promise<number> {
  const cooledBefore = new Date(now - GETI_ALERT_COOLDOWN_MINUTES * 60_000);
  // À la seconde : la colonne `DATETIME` n'en garde pas moins, et la rendre compare cette valeur.
  const reservedAt = new Date(Math.floor(now / 1000) * 1000);
  const notifiedUsers = new Set<number>();
  for (const hit of hits) {
    const { alert, post } = hit;
    if (notifiedUsers.has(alert.userId) || isCoolingDown(alert, cooledBefore)) continue;
    const [reserved] = await db.execute(
      `UPDATE bg_geti_alerts SET last_notified_at = ?
        WHERE id = ? AND paused = 0 AND (last_notified_at IS NULL OR last_notified_at <= ?)`,
      [reservedAt, alert.id, cooledBefore],
    );
    if (affected(reserved) === 0) continue;
    let delivered = false;
    try {
      delivered = await send(alert, post);
    } catch (error) {
      console.error("[geti] alerte non remise", failureReason(error));
    }
    if (delivered) notifiedUsers.add(alert.userId);
    else await releaseReservation(db, hit, reservedAt);
  }
  return notifiedUsers.size;
}

/**
 * Confronte les annonces d'un lot aux alertes actives et prévient leurs
 * propriétaires.
 *
 * - Seules les annonces **récentes** et **ouvertes** comptent
 *   (`isFreshGetiPost`) : le rattrapage du bot ne prévient personne. La
 *   version jugée est celle **gardée** en base, relue : une version plus
 *   ancienne arrivée en retard, ou une annonce retirée entre-temps, ne
 *   prévient pas.
 * - L'auteur d'une annonce n'est pas prévenu par sa propre alerte (même
 *   compte Discord).
 * - Une alerte ne voit une annonce qu'**une fois** : la trace
 *   `bg_geti_alert_hits` (clé alerte + message) se pose par `INSERT IGNORE`,
 *   et seule l'insertion qui la crée compte — une modification, un second
 *   rattrapage ou un envoi en double ne préviennent pas de nouveau.
 * - Au plus une notification par alerte toutes les
 *   `GETI_ALERT_COOLDOWN_MINUTES`, réservée en une instruction
 *   (`UPDATE … WHERE last_notified_at …` + `affectedRows`), et une seule par
 *   compte et par lot ; un envoi qui ne joint personne rend le délai et les
 *   traces posées.
 *
 * Coût : une relecture des annonces récentes, une lecture des alertes actives
 * des catégories du lot (au plus `GETI_ALERT_SCAN_MAX` lignes, borne signalée
 * dans pm2), deux instructions par annonce touchée pour les traces, puis `annonces récentes × alertes de la
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
  send?: GetiAlertSender,
): Promise<GetiAlertOutcome> {
  const outcome: GetiAlertOutcome = { matched: 0, notified: 0 };
  try {
    // Premier tri sur la version reçue (rien à lire pour le rattrapage), puis
    // sur la version gardée, relue : c'est elle que la page montre.
    const received = posts.filter((post) => isAlertable(post, now));
    if (received.length === 0) return outcome;
    const db = executor ?? (await getDatabase());
    const fresh = (await loadStoredVersions(db, received, now)).filter((post) => isAlertable(post, now));
    if (fresh.length === 0) return outcome;
    const alerts = await loadActiveAlerts(db, [...new Set(fresh.map((post) => post.category))]);
    if (alerts.length === 0) return outcome;

    const firstHits = await recordAlertHits(db, fresh, alerts, now, outcome);
    outcome.notified = await sendReservedAlerts(db, firstHits, now, send ?? recipientSender(usersToNotify(firstHits, now)));
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[geti] passe d'alertes impossible", failureReason(error));
  }
  return outcome;
}

/** Passes d'alertes en attente de leur tour, au plus ; une de plus est abandonnée (signalé dans pm2). */
export const GETI_ALERT_QUEUE_MAX = 100;

let queueTail: Promise<unknown> = Promise.resolve();
let queued = 0;

/**
 * Met en file la passe d'alertes d'un lot reçu : les passes se suivent **une à
 * une** plutôt que de se chevaucher. Deux lots rapprochés lanceraient sinon
 * deux passes qui lisent les mêmes alertes et envoient en même temps — des
 * appels au bot qui s'ajoutent d'un coup (coupe-circuit) pour des comptes que
 * la première passe est déjà en train de prévenir. Seules les annonces encore
 * récentes entrent en file (le rattrapage du bot n'en met aucune) ; une passe
 * jugée à son tour, pas à l'arrivée du lot. Ne lève jamais.
 */
export function scheduleGetiAlerts(posts: readonly GetiAlertPost[], now: number = Date.now()): void {
  const alertable = posts.filter((post) => isAlertable(post, now));
  if (alertable.length === 0) return;
  if (queued >= GETI_ALERT_QUEUE_MAX) {
    console.warn("[geti] file des alertes pleine:", GETI_ALERT_QUEUE_MAX);
    return;
  }
  queued += 1;
  queueTail = queueTail
    .then(() => notifyGetiAlerts(alertable))
    .catch(() => undefined)
    .finally(() => {
      queued -= 1;
    });
}
