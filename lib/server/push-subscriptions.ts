/**
 * Abonnements push des appareils, sujets coupés par compte, et distribution.
 *
 * Le protocole vit dans `./web-push`, la règle dans
 * `lib/shared/push-notifications.ts`. Ce module ne fait que la base : ranger un
 * abonnement, le retirer, lire les réglages d'un compte, et remettre un message
 * à tous les appareils de comptes donnés.
 *
 * **Jamais une exception vers l'appelant de `pushToUsers`** : une notification
 * suit une écriture déjà faite (un score, une demande d'adhésion), et un service
 * de push en panne ne doit pas la faire paraître échouée.
 */
import crypto from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError, rowsOrEmptyIfMissingTable } from "@/lib/server/mysql-errors";
import { toIso } from "@/lib/server/serialization";
import { siteBaseUrl } from "@/lib/server/site-url";
import {
  PUSH_SUBSCRIPTION_RETENTION_DAYS,
  PUSH_TOPIC_KEYS,
  buildPushPayload,
  isPushTopic,
  type PushContent,
  type PushSubscriptionInput,
  type PushTopic,
} from "@/lib/shared/push-notifications";
import { sendWebPush, webPushConfig, type WebPushConfig } from "./web-push";

export function endpointHash(endpoint: string): string {
  return crypto.createHash("sha256").update(endpoint).digest("hex");
}

/**
 * Range l'abonnement d'un appareil pour le compte connecté.
 *
 * Un appareil déjà abonné par un autre compte (navigateur partagé, changement
 * de compte) passe au nouveau — mais **seulement sur preuve** : les clés
 * `p256dh`/`auth` doivent être celles déjà rangées. Un navigateur n'a qu'un
 * abonnement par site et le rend identique à quiconque s'y connecte, si bien
 * que le cas légitime la fournit toujours ; l'adresse seule, elle, n'est pas un
 * secret suffisant — c'est la règle de `deleteSubscription`, et l'écriture ne
 * pouvait pas en suivre une plus lâche : qui connaissait l'adresse d'un autre
 * appareil pouvait le rendre muet (clés remplacées, notifications
 * indéchiffrables) ou y faire arriver les siennes.
 *
 * @returns `false` si l'appareil reste à un autre compte, faute de preuve.
 */
export async function saveSubscription(userId: number, subscription: PushSubscriptionInput): Promise<boolean> {
  const db = await getDatabase();
  const hash = endpointHash(subscription.endpoint);
  // La condition est répétée sur chaque affectation, **jamais sur une valeur
  // déjà réécrite** : les affectations se lisent de gauche à droite, d'où
  // `user_id` en dernier. Elle reste vraie de bout en bout quand elle l'était
  // au départ (même compte, ou clés identiques jusqu'au bout), et fausse de
  // même — rien n'est alors touché. Les dates ne repartent que si l'appareil
  // **change de compte** : le panneau renvoie l'abonnement à chaque ouverture,
  // et la date d'abonnement deviendrait sinon celle de la dernière visite.
  const allowed = `(user_id = VALUES(user_id) OR (p256dh = VALUES(p256dh) AND auth = VALUES(auth)))`;
  await db.execute(
    `INSERT INTO bg_push_subscriptions (user_id, endpoint_hash, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       created_at = IF(user_id = VALUES(user_id) OR NOT ${allowed}, created_at, CURRENT_TIMESTAMP),
       last_success_at = IF(user_id = VALUES(user_id) OR NOT ${allowed}, last_success_at, NULL),
       endpoint = IF(${allowed}, VALUES(endpoint), endpoint),
       p256dh = IF(${allowed}, VALUES(p256dh), p256dh),
       auth = IF(${allowed}, VALUES(auth), auth),
       user_id = IF(${allowed}, VALUES(user_id), user_id)`,
    [userId, hash, subscription.endpoint, subscription.p256dh, subscription.auth],
  );
  // `affectedRows` ne distingue pas un refus d'une écriture à l'identique
  // (mysql2 pose `FOUND_ROWS`) : on relit le titulaire.
  const [rows] = await db.execute<(RowDataPacket & { user_id: number })[]>(
    `SELECT user_id FROM bg_push_subscriptions WHERE endpoint_hash = ?`,
    [hash],
  );
  return Number(rows[0]?.user_id) === userId;
}

/**
 * Retire l'abonnement d'un appareil. Borné au compte connecté : l'adresse d'un
 * abonnement n'est pas un secret suffisant pour désabonner l'appareil d'autrui.
 */
export async function deleteSubscription(userId: number, endpoint: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM bg_push_subscriptions WHERE endpoint_hash = ? AND user_id = ?`, [
    endpointHash(endpoint),
    userId,
  ]);
}

/** Nombre d'appareils abonnés au compte. */
export async function countDevices(userId: number): Promise<number> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { devices: number })[]>(
    `SELECT COUNT(*) AS devices FROM bg_push_subscriptions WHERE user_id = ?`,
    [userId],
  );
  return Number(rows[0]?.devices ?? 0);
}

export async function loadDisabledTopics(userId: number): Promise<PushTopic[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { topic: string })[]>(
    `SELECT topic FROM bg_push_topic_optouts WHERE user_id = ?`,
    [userId],
  );
  const set = new Set(rows.map((row) => row.topic).filter(isPushTopic));
  return PUSH_TOPIC_KEYS.filter((topic) => set.has(topic));
}

/** Remplace l'ensemble des sujets coupés du compte. */
export async function saveDisabledTopics(userId: number, topics: readonly PushTopic[]): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`DELETE FROM bg_push_topic_optouts WHERE user_id = ?`, [userId]);
    for (const topic of topics) {
      await connection.execute(`INSERT INTO bg_push_topic_optouts (user_id, topic) VALUES (?, ?)`, [
        userId,
        topic,
      ]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

type SubscriptionRow = RowDataPacket & {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Envois simultanés au plus : un tournoi prévient des dizaines d'appareils. */
const PUSH_CONCURRENCY = 8;

async function inBatches<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(run));
  }
}

export type PushOptions = {
  /** `high` pour ce qui n'attend pas (départ de match) : réveille un téléphone en veille. */
  urgency?: "normal" | "high";
  /** Au-delà, un appareil éteint ne reçoit plus le message — il serait périmé. */
  ttlSeconds?: number;
};

/**
 * Remet un message à tous les appareils des comptes donnés, sauf ceux qui ont
 * coupé ce sujet et les comptes supprimés.
 *
 * @param config injectable pour les tests ; par défaut, l'environnement.
 * @returns le nombre d'appareils atteints.
 */
export async function pushToUsers(
  userIds: readonly number[],
  topic: PushTopic,
  content: PushContent,
  options: PushOptions = {},
  config: WebPushConfig | null = webPushConfig(),
): Promise<number> {
  const ids = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!config || ids.length === 0) return 0;
  try {
    const db = await getDatabase();
    const placeholders = ids.map(() => "?").join(", ");
    const [rows] = await db.query<SubscriptionRow[]>(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth
       FROM bg_push_subscriptions s
       JOIN bg_users u ON u.id = s.user_id AND u.is_deleted = 0
       WHERE s.user_id IN (${placeholders})
         AND NOT EXISTS (SELECT 1 FROM bg_push_topic_optouts o
                         WHERE o.user_id = s.user_id AND o.topic = ?)`,
      [...ids, topic],
    );
    if (rows.length === 0) return 0;

    const payload = JSON.stringify(buildPushPayload(topic, content, siteBaseUrl()));
    const sent: number[] = [];
    const gone: number[] = [];
    await inBatches(rows, PUSH_CONCURRENCY, async (row) => {
      const outcome = await sendWebPush(
        config,
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        payload,
        options,
      );
      if (outcome === "SENT") sent.push(Number(row.id));
      else if (outcome === "GONE") gone.push(Number(row.id));
    });

    // Le service a dit l'abonnement mort : l'appareil a désactivé les
    // notifications ou désinstallé le navigateur. Le garder serait lui écrire
    // à jamais — et garder une donnée qui ne sert plus.
    if (gone.length > 0) {
      await db.query(`DELETE FROM bg_push_subscriptions WHERE id IN (${gone.map(() => "?").join(", ")})`, gone);
    }
    if (sent.length > 0) {
      await db.query(
        `UPDATE bg_push_subscriptions SET last_success_at = NOW() WHERE id IN (${sent.map(() => "?").join(", ")})`,
        sent,
      );
    }
    return sent.length;
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[push] distribution impossible", error);
    return 0;
  }
}

/**
 * Comptes abonnés sur au moins un appareil, parmi ceux qui détiennent une des
 * permissions données — les destinataires d'une notification de staff. Le
 * filtrage fin par permission se fait en mémoire, par la règle partagée : la
 * réécrire en SQL en ferait une seconde.
 */
export async function subscribedStaffCandidates(): Promise<
  { userId: number; isAdmin: boolean; rolesJson: unknown }[]
> {
  try {
    const db = await getDatabase();
    const [rows] = await db.query<
      (RowDataPacket & { id: number; is_admin: number; platform_roles_json: unknown })[]
    >(
      `SELECT u.id, u.is_admin, u.platform_roles_json FROM bg_users u
       WHERE u.is_deleted = 0
         AND (u.is_admin = 1 OR u.platform_roles_json IS NOT NULL)
         AND EXISTS (SELECT 1 FROM bg_push_subscriptions s WHERE s.user_id = u.id)`,
    );
    return rows.map((row) => ({
      userId: Number(row.id),
      isAdmin: Number(row.is_admin) === 1,
      rolesJson: row.platform_roles_json,
    }));
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[push] lecture du staff impossible", error);
    return [];
  }
}

/**
 * Oublie les abonnements restés sans remise depuis
 * {@link PUSH_SUBSCRIPTION_RETENTION_DAYS} jours : un appareil perdu ou
 * réinitialisé ne prévient pas le site, et son abonnement ne répondrait plus
 * « expiré » qu'à la prochaine notification — qui peut ne jamais venir.
 */
export async function purgeStaleSubscriptions(): Promise<number> {
  try {
    const db = await getDatabase();
    const [result] = await db.execute(
      `DELETE FROM bg_push_subscriptions
       WHERE COALESCE(last_success_at, created_at) < NOW() - INTERVAL ${PUSH_SUBSCRIPTION_RETENTION_DAYS} DAY`,
    );
    return Number((result as { affectedRows?: number }).affectedRows ?? 0);
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[push] purge impossible", error);
    return 0;
  }
}

/**
 * Ce que le site garde des notifications push d'un compte, pour l'export de
 * ses données. Table absente → rien n'a pu être gardé, la lire vide est exact.
 */
export async function exportPushData(userId: number): Promise<{
  devices: { endpoint: string; p256dh: string; auth: string; createdAt: string; lastSuccessAt: string | null }[];
  disabledTopics: string[];
}> {
  const db = await getDatabase();
  const devices = await rowsOrEmptyIfMissingTable(
    db.execute<
      (RowDataPacket & {
        endpoint: string;
        p256dh: string;
        auth: string;
        created_at: Date | string;
        last_success_at: Date | string | null;
      })[]
    >(
      `SELECT endpoint, p256dh, auth, created_at, last_success_at
       FROM bg_push_subscriptions WHERE user_id = ? ORDER BY id`,
      [userId],
    ),
  );
  const topics = await rowsOrEmptyIfMissingTable(
    db.execute<(RowDataPacket & { topic: string })[]>(
      `SELECT topic FROM bg_push_topic_optouts WHERE user_id = ? ORDER BY topic`,
      [userId],
    ),
  );
  return {
    devices: devices.map((row) => ({
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      createdAt: toIso(row.created_at) ?? "",
      lastSuccessAt: toIso(row.last_success_at),
    })),
    disabledTopics: topics.map((row) => row.topic),
  };
}
