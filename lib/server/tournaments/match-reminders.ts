/**
 * Rappels de match envoyés en message privé Discord.
 *
 * La règle — quand un rappel est dû, et ce qu'il dit — vit dans le module pur
 * `lib/shared/discord-notifications.ts`. Ici seulement la mécanique : trouver
 * les manches concernées, réserver le rappel, réunir les destinataires, pousser
 * au bot.
 *
 * **Pourquoi un balayage et pas un minuteur.** Next.js n'a pas d'ordonnanceur,
 * et le bot n'appelle jamais le site en retour (`bot-integration.ts`) : c'est
 * donc le trafic qui entraîne l'horloge, exactement comme `syncVisibleTournaments`
 * fait basculer les états de tournoi. Un `setInterval` de processus serait
 * remis à zéro à chaque redéploiement et dupliqué à chaque worker.
 *
 * **Une date posée tardivement ne rattrape pas les paliers manqués.** Elle
 * donne une **annonce** unique portant la date (`buildMatchScheduleAnnouncement`),
 * puis les rappels qui restent devant. Le partage entre les deux régimes tient
 * à la marque d'observation `SEEN`, posée au premier passage : elle sépare
 * « le site découvre cette date » de « le temps a passé depuis ».
 *
 * **Pourquoi la réservation précède l'envoi.** `bg_match_reminders` porte une
 * clé unique `(match_id, offset_key)` : la ligne est insérée d'abord, et seule
 * l'insertion qui gagne envoie. Deux requêtes concurrentes déclenchent le même
 * balayage — sans ce verrou, le joueur recevrait son rappel en double. Le prix
 * est symétrique et assumé : un bot injoignable au moment précis de l'envoi
 * consomme le palier. C'est le bon sens du risque — un rappel manqué se
 * rattrape au palier suivant, un rappel envoyé en boucle ne se rattrape pas.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  loadEntrantPlayerIds,
  loadNotificationRecipients,
  notifyUsers,
  type NotificationRecipient,
} from "@/lib/server/notify";
import { matchReminderPush } from "@/lib/shared/push-messages";
import {
  MATCH_REMINDER_LOOKAHEAD_MS,
  MATCH_REMINDER_OFFSETS,
  MATCH_SEEN_KEY,
  buildMatchReminderMessage,
  buildMatchScheduleAnnouncement,
  dueMatchReminders,
  matchRoundLabel,
  openedMatchReminders,
  type MatchReminderOffset,
} from "@/lib/shared/discord-notifications";
import { tournamentPageUrl } from "./app-url";

type ScheduledMatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_name: string;
  bracket: string;
  round_number: number;
  start_at: string | Date;
  team1_id: number;
  team2_id: number;
  team1_name: string;
  team2_name: string;
};

type SentReminderRow = RowDataPacket & {
  match_id: number;
  offset_key: string;
};

/**
 * Étranglement du balayage.
 *
 * Une minute : les paliers se comptent en heures, un rappel décalé d'une minute
 * ne se remarque pas, et le site tourne sur un Raspberry Pi — repasser sur le
 * calendrier à chaque lecture de `/tournois` serait payer cher une précision
 * dont personne n'a l'usage.
 */
const SWEEP_THROTTLE_MS = 60_000;

let lastSweepAt = 0;
let pendingSweep: Promise<number> | null = null;

/**
 * Destinataires d'un match, par engagée.
 *
 * Le tag déclaré suffit (`declared`) — le bot résout le membre sur le serveur
 * BlueGenji, et le message ne dit rien de plus qu'un horaire public. L'ID,
 * quand le compte a été lié par Discord, évite ce balayage et reste prioritaire.
 * Un joueur sans Discord reste un destinataire : il peut avoir un appareil
 * abonné aux notifications push.
 */
async function loadRecipientsByTeam(
  teamIds: number[],
): Promise<Map<number, NotificationRecipient[]>> {
  const playersByTeam = await loadEntrantPlayerIds(teamIds);
  const recipients = await loadNotificationRecipients(
    [...playersByTeam.values()].flat(),
    "declared",
  );
  const byUser = new Map(recipients.map((recipient) => [recipient.userId, recipient]));
  const byTeam = new Map<number, NotificationRecipient[]>();
  for (const [teamId, userIds] of playersByTeam) {
    byTeam.set(
      teamId,
      userIds
        .map((userId) => byUser.get(userId))
        .filter((recipient): recipient is NotificationRecipient => recipient !== undefined),
    );
  }
  return byTeam;
}

/** Clés déjà posées pour une manche : paliers envoyés et marque d'observation. */
async function loadSentReminders(matchIds: number[]): Promise<Map<number, Set<string>>> {
  const sent = new Map<number, Set<string>>();
  if (matchIds.length === 0) return sent;

  const db = await getDatabase();
  const placeholders = matchIds.map(() => "?").join(", ");
  const [rows] = await db.query<SentReminderRow[]>(
    `SELECT match_id, offset_key FROM bg_match_reminders WHERE match_id IN (${placeholders})`,
    matchIds,
  );

  for (const row of rows) {
    const matchId = Number(row.match_id);
    const keys = sent.get(matchId);
    if (keys) keys.add(row.offset_key);
    else sent.set(matchId, new Set([row.offset_key]));
  }

  return sent;
}

/**
 * Réserve un palier pour une manche.
 *
 * @returns `true` si la réservation est acquise (c'est à nous d'envoyer),
 *          `false` si une autre requête l'a prise entre-temps.
 */
async function claimReminder(matchId: number, offsetKey: string): Promise<boolean> {
  const db = await getDatabase();
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_match_reminders (match_id, offset_key) VALUES (?, ?)`,
    [matchId, offsetKey],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/**
 * Un envoi retenu : soit un palier de rappel, soit l'annonce d'une manche
 * programmée tardivement (`offset === null`).
 */
type PlannedSend = {
  match: ScheduledMatchRow;
  offset: MatchReminderOffset | null;
  /** Paliers encore devant, pour dire à quand le prochain rappel (annonce). */
  remaining: MatchReminderOffset[];
};

/**
 * Décide ce qu'il y a à envoyer pour une manche, et **réserve** ce qu'elle
 * décide d'envoyer.
 *
 * Deux régimes, séparés par la marque d'observation (`MATCH_SEEN_KEY`) :
 *
 * - **Première observation.** Le site découvre cette date. Si des paliers sont
 *   déjà ouverts — la date a été posée à trois jours, à cinq heures — ils sont
 *   consommés sans message et remplacés par une **annonce** unique qui porte la
 *   date. Sans cela, une manche programmée à trois jours recevrait le rappel
 *   « dans une semaine » : la fenêtre du palier est bel et bien ouverte, mais
 *   ce qu'il annonce est faux.
 * - **Ensuite.** Régime normal : le palier dont la fenêtre s'ouvre part avec sa
 *   formulation.
 *
 * @returns Les envois retenus (au plus un par manche et par passage).
 */
async function planMatchSends(
  match: ScheduledMatchRow,
  now: Date,
  alreadySent: Set<string>,
): Promise<PlannedSend[]> {
  const matchId = Number(match.id);

  if (!alreadySent.has(MATCH_SEEN_KEY)) {
    // La marque d'observation fait aussi office de verrou : seule la requête
    // qui la pose annonce, les concurrentes laissent la manche pour le passage
    // suivant.
    if (!(await claimReminder(matchId, MATCH_SEEN_KEY))) return [];

    const opened = openedMatchReminders(match.start_at, now);
    if (opened.length === 0) return [];

    for (const offset of opened) await claimReminder(matchId, offset.key);
    const openedKeys = new Set(opened.map((offset) => offset.key));
    const remaining = MATCH_REMINDER_OFFSETS.filter((offset) => !openedKeys.has(offset.key));
    return [{ match, offset: null, remaining: [...remaining] }];
  }

  // `alreadySent` porte aussi la marque d'observation, qui n'est pas un palier :
  // on ne transmet que les clés qui en sont.
  const sentOffsets = MATCH_REMINDER_OFFSETS.map((offset) => offset.key).filter((key) =>
    alreadySent.has(key),
  );
  const due = dueMatchReminders(match.start_at, now, sentOffsets);

  const planned: PlannedSend[] = [];
  for (const offset of due) {
    if (await claimReminder(matchId, offset.key)) {
      planned.push({ match, offset, remaining: [] });
    }
  }
  return planned;
}

async function runSweep(now: Date): Promise<number> {
  const db = await getDatabase();

  // Bornes en SQL plutôt qu'en mémoire : le calendrier d'un club actif compte
  // des milliers de manches, dont une poignée sont dans l'horizon de rappel.
  // Les deux engagées sont exigées — un plateau programmé à l'avance dont les
  // qualifiées ne sont pas connues n'a personne à prévenir, et un bye n'est pas
  // un match.
  //
  // La borne haute vient du module partagé et vaut l'horizon **plus une marge** :
  // une fenêtre de lecture égale à l'horizon ferait découvrir chaque manche à la
  // seconde où le palier « une semaine » s'ouvre, donc toujours par le régime
  // d'annonce, et ce palier ne partirait jamais.
  const [matches] = await db.query<ScheduledMatchRow[]>(
    `SELECT m.id, m.tournament_id, m.bracket, m.round_number, m.start_at,
            m.team1_id, m.team2_id,
            t.name AS tournament_name,
            t1.name AS team1_name, t2.name AS team2_name
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.start_at IS NOT NULL
        AND m.start_at > NOW()
        AND m.start_at <= DATE_ADD(NOW(), INTERVAL ? SECOND)
        AND m.status <> 'COMPLETED'`,
    [Math.round(MATCH_REMINDER_LOOKAHEAD_MS / 1000)],
  );
  if (matches.length === 0) return 0;

  const sentByMatch = await loadSentReminders(matches.map((m) => Number(m.id)));

  // La réservation précède le chargement des destinataires : elle est ce qui
  // interdit le doublon, et la retarder d'une requête ouvrirait la fenêtre
  // qu'elle est censée fermer.
  const planned: PlannedSend[] = [];
  for (const match of matches) {
    planned.push(
      ...(await planMatchSends(match, now, sentByMatch.get(Number(match.id)) ?? new Set())),
    );
  }
  if (planned.length === 0) return 0;

  const teamIds = [
    ...new Set(planned.flatMap(({ match }) => [Number(match.team1_id), Number(match.team2_id)])),
  ];
  const recipientsByTeam = await loadRecipientsByTeam(teamIds);

  let dispatched = 0;

  for (const { match, offset, remaining } of planned) {
    const roundLabel = matchRoundLabel(String(match.bracket), Number(match.round_number));
    const url = tournamentPageUrl(Number(match.tournament_id));

    const sides: { teamId: number; teamName: string; opponentName: string }[] = [
      {
        teamId: Number(match.team1_id),
        teamName: String(match.team1_name),
        opponentName: String(match.team2_name),
      },
      {
        teamId: Number(match.team2_id),
        teamName: String(match.team2_name),
        opponentName: String(match.team1_name),
      },
    ];

    // Un message par engagée, pas un pour tout le monde : chaque joueur lit
    // « ton équipe contre l'autre », dans le bon sens.
    for (const side of sides) {
      const recipients = recipientsByTeam.get(side.teamId) ?? [];
      if (recipients.length === 0) continue;

      const context = {
        tournamentName: String(match.tournament_name),
        tournamentUrl: url,
        teamName: side.teamName,
        opponentName: side.opponentName,
        roundLabel,
        startAt: match.start_at,
      };

      const message = offset
        ? buildMatchReminderMessage(offset, context)
        : buildMatchScheduleAnnouncement(context, remaining);

      await notifyUsers(recipients, {
        topic: "MATCH_REMINDER",
        discord: { message, context: offset ? "match-reminder" : "match-scheduled" },
        push: matchReminderPush(
          {
            tournamentId: Number(match.tournament_id),
            tournamentName: context.tournamentName,
            matchId: Number(match.id),
            teamName: side.teamName,
            opponentName: side.opponentName,
            roundLabel,
            startAt: match.start_at,
          },
          offset ? offset.label : null,
        ),
      });
      dispatched += 1;
    }
  }

  return dispatched;
}

/**
 * Envoie les rappels de match dus, au plus une fois par minute.
 *
 * Meilleur effort et jamais bloquant : l'appelant est une lecture de page, pas
 * une tâche de fond, et une panne Discord ne doit pas vider `/tournois`.
 *
 * @param now Instant de référence, injectable pour les tests.
 * @returns Le nombre d'envois déclenchés (0 si le balayage a été étranglé).
 */
export async function dispatchDueMatchReminders(now: Date = new Date()): Promise<number> {
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
export function resetMatchReminderThrottle(): void {
  lastSweepAt = 0;
  pendingSweep = null;
}
