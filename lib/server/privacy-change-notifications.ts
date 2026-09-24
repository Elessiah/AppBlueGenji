import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  isBotCircuitOpen,
  pushDiscordDirectMessages,
  type DiscordRecipient,
} from "@/lib/server/bot-integration";
import { siteBaseUrl } from "@/lib/server/site-url";
import {
  PRIVACY_DM_MIN_INTERVAL_DAYS,
  announceablePrivacyChanges,
  buildPrivacyChangesMessage,
  pendingPrivacyChanges,
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
 * joignable reçoit **un** message par lot de changements qu'il n'a ni acceptés
 * ni déjà reçus : un joueur absent pendant trois changements en reçoit un seul
 * message qui les nomme tous les trois.
 *
 * **Discord est le seul canal de l'association, il ne se spamme pas.** Le
 * message attend que le plus ancien changement dû ait une semaine
 * (`PRIVACY_DM_SETTLE_DAYS`) — le temps que la modale touche les joueurs
 * actifs, qui acceptent et ne reçoivent rien — et ne part pas moins d'un mois
 * (`PRIVACY_DM_MIN_INTERVAL_DAYS`) après le précédent. Les changements publiés
 * entre-temps ne sont pas perdus : ils rejoignent le message suivant.
 *
 * Joignable veut dire : un **identifiant Discord** rattaché, ou un tag
 * **certifié**. Un tag non certifié n'est qu'une saisie, qui peut être celle
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
};

type DoneRow = RowDataPacket & { user_id: number; change_id: string };

function toRecipient(row: CandidateRow): DiscordRecipient | null {
  const handle = row.discord_verified_at ? row.discord_pseudo : null;
  if (!row.discord_id && !handle) return null;
  return { discordId: row.discord_id, handle, label: row.pseudo };
}

/**
 * Les comptes à qui un message est dû maintenant.
 *
 * Une condition par changement **ayant passé le délai de la modale**, jointes
 * par `OR` : le compte existait avant sa publication, ne l'a pas accepté, ne
 * l'a pas reçu. Puis l'intervalle entre deux messages : aucune annonce reçue
 * depuis `PRIVACY_DM_MIN_INTERVAL_DAYS` jours. Les deux filtres sont en base et
 * non après coup, pour la limite du lot : des comptes écartés en mémoire
 * occuperaient ses vingt places à chaque balayage, et ceux d'après ne seraient
 * jamais lus. L'horloge est celle de MySQL, qui a daté `sent_at`. La fenêtre
 * d'annonce borne le nombre de conditions, et les `NOT EXISTS` passent par les
 * clés primaires.
 */
async function loadCandidates(settled: readonly PrivacyChange[]): Promise<CandidateRow[]> {
  const db = await getDatabase();
  const clause = settled
    .map(
      () => `(u.created_at < ?
          AND NOT EXISTS (SELECT 1 FROM bg_privacy_acknowledgments a WHERE a.user_id = u.id AND a.change_id = ?)
          AND NOT EXISTS (SELECT 1 FROM bg_privacy_change_notifications n WHERE n.user_id = u.id AND n.change_id = ?))`,
    )
    .join(" OR ");
  const [rows] = await db.query<CandidateRow[]>(
    `SELECT u.id, u.pseudo, u.discord_id, u.discord_pseudo, u.discord_verified_at, u.created_at
       FROM bg_users u
      WHERE u.is_deleted = 0
        AND (u.discord_id IS NOT NULL OR (u.discord_verified_at IS NOT NULL AND u.discord_pseudo IS NOT NULL))
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
  const groups = new Map<string, { changes: PrivacyChange[]; recipients: DiscordRecipient[]; userIds: number[] }>();
  for (const row of candidates) {
    const recipient = toRecipient(row);
    if (!recipient) continue;
    const userId = Number(row.id);
    // Tous les changements dus, récents compris — mais seulement si l'un d'eux a
    // passé le délai : la relecture peut avoir vu une acceptation depuis.
    const due = privacyDmBatch(
      pendingPrivacyChanges(row.created_at ? String(row.created_at) : null, done.get(userId) ?? [], changes),
      now,
    );
    if (due.length === 0) continue;
    const reserved = await reserve(userId, due);
    if (reserved.length === 0) continue;
    const key = reserved.map((change) => change.id).join("|");
    const group = groups.get(key) ?? { changes: reserved, recipients: [], userIds: [] };
    group.recipients.push(recipient);
    group.userIds.push(userId);
    groups.set(key, group);
  }

  let sent = 0;
  for (const group of groups.values()) {
    const report = await pushDiscordDirectMessages(
      buildPrivacyChangesMessage(group.changes, siteBaseUrl()),
      group.recipients,
      "privacy-changes",
    );
    if (report === null) {
      await release(
        group.userIds,
        group.changes.map((change) => change.id),
      );
      continue;
    }
    sent += report.sent;
  }
  return sent;
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
