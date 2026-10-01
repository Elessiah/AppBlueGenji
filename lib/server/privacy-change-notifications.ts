import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isBotCircuitOpen } from "@/lib/server/bot-integration";
import { notifyUsers, toNotificationRecipient, type NotificationRecipient } from "@/lib/server/notify";
import { privacyChangePush } from "@/lib/shared/push-messages";
import { siteBaseUrl } from "@/lib/server/site-url";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { privacyAudienceSql } from "@/lib/server/privacy-consent";
import { webPushConfig } from "@/lib/server/web-push";
import {
  PRIVACY_DM_MIN_INTERVAL_DAYS,
  announceablePrivacyChanges,
  buildPrivacyChangesMessage,
  privacyChangesForOneMessage,
  pendingPrivacyChanges,
  privacyChangeDay,
  privacyDmBatch,
  settledPrivacyChanges,
  type PrivacyChange,
} from "@/lib/shared/privacy-changes";

/**
 * Annonce en message privé Discord des changements du traitement des données
 * (`lib/shared/privacy-changes.ts`).
 *
 * **Le site rédige, le bot distribue** — même canal que les rappels de match
 * (`POST /internal/notify/dm`), aucune route nouvelle côté bot. Chaque compte
 * joignable reçoit **un** message par lot de changements qu'il n'a ni lus sur le site
 * ni déjà reçus : un joueur absent pendant trois changements en reçoit un seul
 * message qui les nomme tous les trois. Quand ils ne tiennent pas tous sous le
 * plafond du bot, le message nomme ce qui tient et le reste part au balayage
 * suivant (`privacyChangesForOneMessage`) — jamais un changement seulement
 * compté mais tenu pour annoncé.
 *
 * **Discord est le seul canal de l'association, il ne se spamme pas.** Le
 * message attend que le plus ancien changement dû ait une semaine
 * (`PRIVACY_DM_SETTLE_DAYS`) — le temps que la modale touche les joueurs
 * actifs, qui la lisent et ne reçoivent rien — et ne part pas moins d'un mois
 * (`PRIVACY_DM_MIN_INTERVAL_DAYS`) après le précédent. Les changements publiés
 * entre-temps ne sont pas perdus : ils rejoignent le message suivant.
 *
 * Joignable veut dire : un **identifiant Discord** rattaché, ou un tag
 * **certifié** — ou un appareil abonné aux notifications push, qui reçoit le
 * même lot en résumé (`privacyChangePush`). Un tag non certifié n'est qu'une saisie, qui peut être celle
 * d'un autre — on n'écrit pas à un inconnu pour lui parler du compte de
 * quelqu'un. Le bot n'écrit de toute façon qu'aux membres du serveur BlueGenji.
 *
 * Aucun ordonnanceur : le balayage est entraîné par le trafic (mise en page
 * racine), étranglé à une minute et à vol unique, par lots de
 * {@link PRIVACY_DM_BATCH_SIZE} comptes — un bot qui écrit en série ne doit pas
 * dépasser son délai de réponse, sans quoi le lot serait rendu puis renvoyé.
 *
 * La ligne `bg_privacy_change_notifications` est **réservée avant l'envoi** :
 * c'est la clé primaire qui interdit le doublon. Bot injoignable → la
 * réservation est rendue et le lot repartira (un doublon vaut mieux qu'un
 * silence). Membre introuvable ou messages privés fermés → elle reste : ce
 * joueur verra la modale, réessayer à chaque minute ne changerait rien.
 */

/** Comptes traités par balayage. */
export const PRIVACY_DM_BATCH_SIZE = 20;

const SWEEP_THROTTLE_MS = 60_000;

let lastSweepAt = 0;
let pendingSweep: Promise<number> | null = null;

type CandidateRow = RowDataPacket & {
  id: number;
  pseudo: string;
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: string | null;
  created_at: string | null;
  google_linked: 0 | 1 | null;
};

type DoneRow = RowDataPacket & { user_id: number; change_id: string };

/**
 * Les comptes à qui un message est dû maintenant.
 *
 * Une condition par changement **ayant passé le délai de la modale**, jointes
 * par `OR` : le compte existait avant sa publication, n'en a pas pris connaissance, ne
 * l'a pas reçu. Puis l'intervalle entre deux messages : aucune annonce reçue
 * depuis `PRIVACY_DM_MIN_INTERVAL_DAYS` jours. Les deux filtres sont en base et
 * non après coup, pour la limite du lot : des comptes écartés en mémoire
 * occuperaient ses vingt places à chaque balayage, et ceux d'après ne seraient
 * jamais lus. L'horloge est celle de MySQL, qui a daté `sent_at`. La fenêtre
 * d'annonce borne le nombre de conditions, et les `NOT EXISTS` passent par les
 * clés primaires.
 */
async function loadCandidates(settled: readonly PrivacyChange[]): Promise<CandidateRow[]> {
  // Un compte sans Discord n'est candidat que si le push est **allumé** : sans
  // clés, rien ne peut lui parvenir, et le réserver consommerait l'annonce pour
  // de bon. Et si la table des abonnements manque (table tolérée), la lecture
  // retombe sur Discord seul plutôt que d'éteindre toute l'annonce.
  if (webPushConfig()) {
    try {
      return await queryCandidates(settled, true);
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
  }
  return queryCandidates(settled, false);
}

async function queryCandidates(settled: readonly PrivacyChange[], withPush: boolean): Promise<CandidateRow[]> {
  const db = await getDatabase();
  const clause = settled
    .map(
      (change) => `(u.created_at < ? AND ${privacyAudienceSql(change)}
          AND NOT EXISTS (SELECT 1 FROM bg_privacy_acknowledgments a WHERE a.user_id = u.id AND a.change_id = ?)
          AND NOT EXISTS (SELECT 1 FROM bg_privacy_change_notifications n WHERE n.user_id = u.id AND n.change_id = ?))`,
    )
    .join(" OR ");
  const [rows] = await db.query<CandidateRow[]>(
    `SELECT u.id, u.pseudo, u.discord_id, u.discord_pseudo, u.discord_verified_at, u.created_at,
            u.google_sub IS NOT NULL AS google_linked
       FROM bg_users u
      WHERE u.is_deleted = 0
        AND (u.discord_id IS NOT NULL OR (u.discord_verified_at IS NOT NULL AND u.discord_pseudo IS NOT NULL)
             ${withPush ? "OR EXISTS (SELECT 1 FROM bg_push_subscriptions s WHERE s.user_id = u.id)" : ""})
        AND (${clause})
        AND NOT EXISTS (SELECT 1 FROM bg_privacy_change_notifications r
                         WHERE r.user_id = u.id AND r.sent_at > NOW() - INTERVAL ? DAY)
      ORDER BY u.id
      LIMIT ${PRIVACY_DM_BATCH_SIZE}`,
    [...settled.flatMap((change) => [change.publishedAt, change.id, change.id]), PRIVACY_DM_MIN_INTERVAL_DAYS],
  );
  return rows;
}

/** Acceptations et annonces déjà faites, par compte — deux raisons de ne plus écrire. */
async function loadDone(userIds: number[]): Promise<Map<number, string[]>> {
  const db = await getDatabase();
  const placeholders = userIds.map(() => "?").join(", ");
  const [rows] = await db.query<DoneRow[]>(
    `SELECT user_id, change_id FROM bg_privacy_acknowledgments WHERE user_id IN (${placeholders})
     UNION ALL
     SELECT user_id, change_id FROM bg_privacy_change_notifications WHERE user_id IN (${placeholders})`,
    [...userIds, ...userIds],
  );
  const done = new Map<number, string[]>();
  for (const row of rows) {
    const userId = Number(row.user_id);
    done.set(userId, [...(done.get(userId) ?? []), String(row.change_id)]);
  }
  return done;
}

/** Réserve chaque changement ; ne garde que ceux que ce balayage a obtenus. */
async function reserve(userId: number, changes: PrivacyChange[]): Promise<PrivacyChange[]> {
  const db = await getDatabase();
  const reserved: PrivacyChange[] = [];
  for (const change of changes) {
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT IGNORE INTO bg_privacy_change_notifications (user_id, change_id) VALUES (?, ?)`,
      [userId, change.id],
    );
    if (result.affectedRows === 1) reserved.push(change);
  }
  return reserved;
}

async function release(userIds: number[], changeIds: string[]): Promise<void> {
  const db = await getDatabase();
  await db.query(
    `DELETE FROM bg_privacy_change_notifications
      WHERE user_id IN (${userIds.map(() => "?").join(", ")})
        AND change_id IN (${changeIds.map(() => "?").join(", ")})`,
    [...userIds, ...changeIds],
  );
}

async function runSweep(now: Date): Promise<number> {
  const changes = announceablePrivacyChanges(now);
  // Rien n'a encore passé le délai de la modale : personne n'est à prévenir.
  const settled = settledPrivacyChanges(now, changes);
  if (settled.length === 0) return 0;
  // Coupe-circuit ouvert : réserver puis rendre ferait tourner une pompe
  // d'`INSERT`/`DELETE` pendant toute la panne.
  if (isBotCircuitOpen()) return 0;

  const candidates = await loadCandidates(settled);
  if (candidates.length === 0) return 0;
  const done = await loadDone(candidates.map((row) => Number(row.id)));

  // Un message par **ensemble** de changements : deux comptes qui ont les mêmes
  // à recevoir partagent un seul appel au bot.
  const groups = new Map<string, { changes: PrivacyChange[]; recipients: NotificationRecipient[] }>();
  const siteUrl = siteBaseUrl();
  const batchByDue = new Map<string, PrivacyChange[]>();
  for (const row of candidates) {
    const recipient = toNotificationRecipient(row, "proven");
    const userId = recipient.userId;
    // Tous les changements dus, récents compris — mais seulement si l'un d'eux a
    // passé le délai : la relecture peut avoir vu une prise de connaissance depuis.
    const due = privacyDmBatch(
      pendingPrivacyChanges(
        row.created_at ? String(row.created_at) : null,
        done.get(userId) ?? [],
        privacyChangeDay(now),
        changes,
        { googleLinked: Number(row.google_linked) === 1 },
      ),
      now,
    );
    if (due.length === 0) continue;
    // Seulement ce qu'un message peut **nommer** : un changement réservé mais
    // seulement compté (« … et 1 autre ») serait tenu pour annoncé sans que son
    // titre ait été écrit. Le reste demeure dû et part au message suivant,
    // donc après l'intervalle minimal (`PRIVACY_DM_MIN_INTERVAL_DAYS`).
    // Calculé une fois par ensemble de changements dus : la plupart des comptes
    // du lot ont le même.
    const dueKey = due.map((change) => change.id).join("|");
    let batch = batchByDue.get(dueKey);
    if (!batch) {
      batch = privacyChangesForOneMessage(due, siteUrl);
      batchByDue.set(dueKey, batch);
    }
    const reserved = await reserve(userId, batch);
    if (reserved.length === 0) continue;
    const key = reserved.map((change) => change.id).join("|");
    const group = groups.get(key) ?? { changes: reserved, recipients: [] };
    group.recipients.push(recipient);
    groups.set(key, group);
  }

  let sent = 0;
  for (const group of groups.values()) {
    sent += await sendPrivacyGroup(group, siteUrl);
  }
  return sent;
}

/**
 * Envoie l'annonce d'un ensemble de changements à ses destinataires.
 *
 * @returns Le nombre de messages remis (push et Discord confondus).
 */
async function sendPrivacyGroup(
  group: { changes: PrivacyChange[]; recipients: NotificationRecipient[] },
  siteUrl: string | null,
): Promise<number> {
  const report = await notifyUsers(group.recipients, {
    topic: "PRIVACY_CHANGE",
    discord: { message: buildPrivacyChangesMessage(group.changes, siteUrl), context: "privacy-changes" },
    push: privacyChangePush(group.changes.map((change) => change.title)),
  });
  if (report.discord !== null) return report.pushed + report.discord.sent;
  // Bot injoignable : seuls les comptes qu'il devait joindre sont rendus au
  // balayage suivant — ceux qui n'avaient que le push l'ont reçu.
  const viaDiscord = group.recipients
    .filter((recipient) => recipient.discord !== null)
    .map((recipient) => recipient.userId);
  if (viaDiscord.length > 0) {
    await release(
      viaDiscord,
      group.changes.map((change) => change.id),
    );
  }
  return report.pushed;
}

/**
 * Envoie les annonces dues, au plus une fois par minute.
 *
 * Meilleur effort et jamais bloquant : l'appelant est le rendu d'une page.
 *
 * @param now Instant de référence des décisions **sur les dates de publication**
 *   (fenêtre d'annonce, délai de la modale), injectable pour les tests.
 *   L'intervalle entre deux messages, lui, se juge sur l'horloge de MySQL,
 *   **délibérément** : `sent_at` est daté par `CURRENT_TIMESTAMP`, et le
 *   comparer à un instant venu de Node ferait dépendre la règle du fuseau que
 *   le pilote applique aux dates qu'il envoie.
 * @returns Le nombre de messages remis (0 si le balayage a été étranglé).
 */
export async function dispatchPrivacyChangeNotifications(now: Date = new Date()): Promise<number> {
  if (pendingSweep) return pendingSweep;
  if (Date.now() - lastSweepAt < SWEEP_THROTTLE_MS) return 0;

  pendingSweep = runSweep(now);
  try {
    return await pendingSweep;
  } finally {
    lastSweepAt = Date.now();
    pendingSweep = null;
  }
}

/** Remet l'étranglement à zéro. Réservé aux tests. */
export function resetPrivacyNotificationThrottle(): void {
  lastSweepAt = 0;
  pendingSweep = null;
}
