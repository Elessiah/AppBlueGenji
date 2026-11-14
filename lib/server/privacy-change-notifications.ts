import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { isBotCircuitOpen } from "@/lib/server/bot-integration";
import { outboundMuted } from "@/lib/server/outbound-mute";
import { notifyUsers, toNotificationRecipient, type NotificationRecipient } from "@/lib/server/notify";
import { privacyChangePush } from "@/lib/shared/push-messages";
import { localizedPrivacyChanges } from "@/lib/shared/privacy-changes-en";
import { siteBaseUrl } from "@/lib/server/site-url";
import { isDuplicateEntryError, isMissingParentRowError, isMissingTableError } from "@/lib/server/mysql-errors";
import { LIVE_STAFF_SQL, privacyAudienceSql } from "@/lib/server/privacy-consent";
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
 * plafond du bot, le message ne donne que leurs titres ; s'ils ne tiennent
 * toujours pas, il nomme ce qui tient, compte le reste, et ce reste part au
 * balayage suivant (`privacyChangesForOneMessage`) — jamais un changement
 * seulement compté mais tenu pour annoncé.
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

/**
 * Après un balayage **sans aucun compte à prévenir**, le suivant attend plus :
 * la lecture parcourt tous les comptes joignables (un `NOT EXISTS` par
 * changement annonçable) et ne trouverait rien de neuf, sinon un compte devenu
 * joignable depuis — que dix minutes de plus ne font pas attendre longtemps.
 */
export const SWEEP_IDLE_THROTTLE_MS = 600_000;

let lastSweepAt = 0;
let lastSweepFoundNobody = false;
/**
 * Les changements passés le délai de la modale lors du balayage sans personne :
 * un changement qui le passe depuis lève l'attente longue, dans **chaque**
 * processus — l'état est propre à chacun, et seul le gagnant du verrou le tient.
 */
let lastIdleSettledKey = "";

/** Identité d'un ensemble de changements annonçables passés le délai. */
function keyOf(settled: readonly PrivacyChange[]): string {
  return settled.map((change) => change.id).join("|");
}

/**
 * Comptes dont aucun changement dû ne tient nommé dans un message
 * (`privacyChangesForOneMessage` vide — garde-fou, le registre le vérifie) :
 * écartés de la lecture tant que l'ensemble des changements passés le délai
 * reste le même, sans quoi les mêmes vingt premiers occuperaient le lot à
 * chaque balayage et les suivants ne seraient jamais lus. Propre au processus,
 * vidé quand l'ensemble change (`unnameableKey`).
 */
const unnameableUserIds = new Set<number>();
let unnameableKey = "";
let pendingSweep: Promise<number> | null = null;

type CandidateRow = RowDataPacket & {
  id: number;
  pseudo: string;
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: string | null;
  created_at: string | null;
  google_linked: 0 | 1 | null;
  live_staff: 0 | 1 | null;
};

/** Pool ou connexion du verrou : tout ce qui sait `query`. */
type Queryable = Pick<Pool, "query">;

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
async function loadCandidates(
  db: Queryable,
  settled: readonly PrivacyChange[],
  liveStaff: boolean,
  excluded: readonly number[],
): Promise<CandidateRow[]> {
  // Un compte sans Discord n'est candidat que si le push est **allumé** : sans
  // clés, rien ne peut lui parvenir, et le réserver consommerait l'annonce pour
  // de bon. Et si la table des abonnements manque (table tolérée), la lecture
  // retombe sur Discord seul plutôt que d'éteindre toute l'annonce.
  if (webPushConfig()) {
    try {
      return await queryCandidates(db, settled, true, liveStaff, excluded);
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
  }
  return queryCandidates(db, settled, false, liveStaff, excluded);
}

/**
 * `liveStaff` : une entrée `LIVE_STAFF` est-elle encore annonçable ? Sinon le
 * fait n'est pas calculé — aucune entrée ne le lit, inutile d'évaluer
 * `LIVE_STAFF_SQL` sur chaque compte à chaque balayage.
 */
async function queryCandidates(
  db: Queryable,
  settled: readonly PrivacyChange[],
  withPush: boolean,
  liveStaff: boolean,
  excluded: readonly number[],
): Promise<CandidateRow[]> {
  const clause = settled
    .map(
      (change) => `(u.created_at < ? AND ${privacyAudienceSql(change)}
          AND NOT EXISTS (SELECT 1 FROM bg_privacy_acknowledgments a WHERE a.user_id = u.id AND a.change_id = ?)
          AND NOT EXISTS (SELECT 1 FROM bg_privacy_change_notifications n WHERE n.user_id = u.id AND n.change_id = ?))`,
    )
    .join(" OR ");
  const [rows] = await db.query<CandidateRow[]>(
    `SELECT u.id, u.pseudo, u.discord_id, u.discord_pseudo, u.discord_verified_at, u.locale, u.created_at,
            u.google_sub IS NOT NULL AS google_linked, ${liveStaff ? LIVE_STAFF_SQL : "0"} AS live_staff
       FROM bg_users u
      WHERE u.is_deleted = 0
        AND (u.discord_id IS NOT NULL OR (u.discord_verified_at IS NOT NULL AND u.discord_pseudo IS NOT NULL)
             ${withPush ? "OR EXISTS (SELECT 1 FROM bg_push_subscriptions s WHERE s.user_id = u.id)" : ""})
        AND (${clause})
        AND NOT EXISTS (SELECT 1 FROM bg_privacy_change_notifications r
                         WHERE r.user_id = u.id AND r.sent_at > NOW() - INTERVAL ? DAY)
        ${excluded.length > 0 ? `AND u.id NOT IN (${excluded.map(() => "?").join(", ")})` : ""}
      ORDER BY u.id
      LIMIT ${PRIVACY_DM_BATCH_SIZE}`,
    [
      ...settled.flatMap((change) => [change.publishedAt, change.id, change.id]),
      PRIVACY_DM_MIN_INTERVAL_DAYS,
      ...excluded,
    ],
  );
  return rows;
}

/**
 * Un message à envoyer : les changements réservés, le nombre de changements
 * dus gardés pour le message suivant (seulement comptés), ses destinataires.
 */
type PrivacyGroup = { changes: PrivacyChange[]; later: number; recipients: NotificationRecipient[] };

/** Acceptations et annonces déjà faites, par compte — deux raisons de ne plus écrire. */
async function loadDone(db: Queryable, userIds: number[]): Promise<Map<number, string[]>> {
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

/**
 * Réserve les changements d'un compte **en une instruction**, tout ou rien :
 * un `INSERT` simple de plusieurs lignes que la base annule en entier si l'une
 * est déjà prise (`ER_DUP_ENTRY`, annulation de l'instruction sous InnoDB).
 * Rend `null` dans ce cas — aucune ligne n'est restée : un `INSERT IGNORE`
 * partiel laissait les autres tenues pour annoncées sans jamais être envoyées.
 * Rend aussi `null` pour un compte effacé depuis la lecture (clé étrangère) :
 * l'erreur levée aurait abandonné le balayage entier, et les comptes déjà
 * réservés avant lui seraient restés annoncés sans message.
 */
async function reserve(db: Queryable, userId: number, changes: PrivacyChange[]): Promise<PrivacyChange[] | null> {
  try {
    await db.query<ResultSetHeader>(
      `INSERT INTO bg_privacy_change_notifications (user_id, change_id)
       VALUES ${changes.map(() => "(?, ?)").join(", ")}`,
      changes.flatMap((change) => [userId, change.id]),
    );
  } catch (error) {
    if (isDuplicateEntryError(error) || isMissingParentRowError(error)) return null;
    throw error;
  }
  return changes;
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

  // Un seul balayage à la fois, **entre processus** (pm2 en lance plusieurs) :
  // deux balayages simultanés se partageaient les réservations d'un même compte,
  // chacun rendait sa part et aucun n'écrivait — à chaque minute de départ
  // commun, sans fin. Celui qui n'obtient pas le verrou passe son tour.
  let groups: Map<string, PrivacyGroup>;
  try {
    // Le verrou ne couvre que la lecture et les réservations, sur la connexion
    // qui le tient (une seule connexion du pool, brève) : les envois au bot,
    // lents, partent après, les réservations étant déjà durables.
    groups = await withNamedLock(await getDatabase(), PRIVACY_SWEEP_LOCK_NAME, 0, (connection) =>
      reserveUnderLock(connection, now, changes, settled),
    );
  } catch (error) {
    if (error instanceof NamedLockUnavailableError) return 0;
    throw error;
  }
  const siteUrl = siteBaseUrl();
  let sent = 0;
  for (const group of groups.values()) {
    sent += await sendPrivacyGroup(group, siteUrl);
  }
  return sent;
}

/** Verrou nommé du balayage des annonces de confidentialité. */
export const PRIVACY_SWEEP_LOCK_NAME = "bg_privacy_change_sweep";

async function reserveUnderLock(
  db: Queryable,
  now: Date,
  changes: readonly PrivacyChange[],
  settled: readonly PrivacyChange[],
): Promise<Map<string, PrivacyGroup>> {
  const groups = new Map<string, PrivacyGroup>();
  const currentKey = keyOf(settled);
  if (unnameableKey !== currentKey) {
    unnameableUserIds.clear();
    unnameableKey = currentKey;
  }
  const candidates = await loadCandidates(
    db,
    settled,
    changes.some((change) => change.audience === "LIVE_STAFF"),
    [...unnameableUserIds],
  );
  lastSweepFoundNobody = candidates.length === 0;
  lastIdleSettledKey = currentKey;
  if (candidates.length === 0) return groups;
  const done = await loadDone(db, candidates.map((row) => Number(row.id)));

  // Un message par **ensemble** de changements : deux comptes qui ont les mêmes
  // à recevoir partagent un seul appel au bot.
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
        { googleLinked: Number(row.google_linked) === 1, liveStaff: Number(row.live_staff) === 1 },
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
      batch = privacyChangesForOneMessage(due, siteUrl, localizedPrivacyChanges(due, "en"));
      batchByDue.set(dueKey, batch);
    }
    // Rien de nommable (garde-fou, le registre le vérifie) : rien n'est réservé,
    // et le compte sort des lectures suivantes (`unnameableUserIds`) pour ne
    // pas tenir une place du lot à chaque balayage.
    if (batch.length === 0) {
      unnameableUserIds.add(userId);
      continue;
    }
    // Une partie du lot déjà réservée depuis la relecture (`loadDone`) — plus
    // possible entre balayages, sérialisés par le verrou nommé ; garde-fou
    // seulement : ce compte est écarté, sans message, plutôt qu'un en-tête ou un
    // « … et N autre(s) » faux. Le balayage suivant relit l'état. Une réservation
    // laissée par un processus tué entre `reserve` et l'envoi compte, elle, pour
    // annoncée : l'envoi est « au plus une fois », jamais doublé.
    const reserved = await reserve(db, userId, batch);
    if (!reserved) continue;
    // Ce qui reste dû après ce lot est compté dans le message (« … et N
    // autre(s) ») : le joueur sait que d'autres changements l'attendent.
    const later = due.length - batch.length;
    const key = `${reserved.map((change) => change.id).join("|")}#${later}`;
    const group = groups.get(key) ?? { changes: reserved, later, recipients: [] };
    group.recipients.push(recipient);
    groups.set(key, group);
  }

  return groups;
}

/**
 * Envoie l'annonce d'un ensemble de changements à ses destinataires.
 *
 * @returns Le nombre de messages remis (push et Discord confondus).
 */
async function sendPrivacyGroup(group: PrivacyGroup, siteUrl: string | null): Promise<number> {
  const report = await notifyUsers(group.recipients, {
    topic: "PRIVACY_CHANGE",
    // Message privé et push dans la langue de chaque destinataire (lot 9-3,
    // BOT-NOTIF-LANG) ; le lot tient sous le plafond dans les deux langues
    // (`privacyChangesForOneMessage`).
    discord: {
      message: (locale) =>
        buildPrivacyChangesMessage(localizedPrivacyChanges(group.changes, locale), siteUrl, locale, group.later),
      context: "privacy-changes",
    },
    // Le push compte comme le message privé du même envoi (`group.later`).
    push: (locale) =>
      privacyChangePush(
        localizedPrivacyChanges(group.changes, locale).map((change) => change.title),
        locale,
        group.later,
      ),
  });
  // Bot injoignable pour un appel (une langue) ou pour tous : seuls les comptes
  // qu'il devait joindre par cet appel sont rendus au balayage suivant — ceux
  // qui n'avaient que le push l'ont reçu, et l'autre langue est partie.
  const viaDiscord = report.discordUnreachedUserIds;
  if (viaDiscord.length > 0) {
    await release(
      viaDiscord,
      group.changes.map((change) => change.id),
    );
  }
  return report.pushed + (report.discord?.sent ?? 0);
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
  // Envois coupés (rejeu d'une restauration) : le balayage réserverait avant
  // un envoi impossible, l'annonce serait perdue. Rien ne part, rien n'est lu.
  if (outboundMuted()) return 0;
  if (pendingSweep) return pendingSweep;
  const elapsed = Date.now() - lastSweepAt;
  if (elapsed < SWEEP_THROTTLE_MS) return 0;
  // L'attente longue, seulement passé l'ordinaire : le registre n'est relu
  // (ensemble passé le délai) qu'une fois par minute au plus, pas à chaque rendu.
  if (
    lastSweepFoundNobody &&
    elapsed < SWEEP_IDLE_THROTTLE_MS &&
    keyOf(settledPrivacyChanges(now, announceablePrivacyChanges(now))) === lastIdleSettledKey
  ) {
    return 0;
  }

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
  lastSweepFoundNobody = false;
  lastIdleSettledKey = "";
  unnameableUserIds.clear();
  unnameableKey = "";
  pendingSweep = null;
}
