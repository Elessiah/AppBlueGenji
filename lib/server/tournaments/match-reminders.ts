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
 * **Une manche découverte par le balayage est annoncée.** `setMatchStartAt`
 * annonce lui-même une date posée sur deux engagées connues (et pose la marque
 * d'observation `SEEN`) ; le balayage ne découvre donc que les manches dont une
 * engagée manquait alors, ou a changé. Il leur donne une **annonce** unique
 * portant la date (`buildMatchScheduleAnnouncement`), consomme le palier déjà
 * ouvert, et laisse courir celui qui reste devant.
 *
 * **Pourquoi la réservation précède l'envoi.** `bg_match_reminders` porte une
 * clé unique `(match_id, offset_key)` : la ligne est insérée d'abord, et seule
 * l'insertion qui gagne envoie. Deux requêtes concurrentes déclenchent le même
 * balayage — sans ce verrou, le joueur recevrait son rappel en double. Le prix
 * est symétrique et assumé : un bot injoignable au moment précis de l'envoi
 * consomme le palier — et il n'en reste qu'un (24 h) : ce rappel-là est perdu.
 * C'est le bon sens du risque — un rappel manqué ne s'excuse qu'une fois, un
 * rappel envoyé en boucle ne se rattrape pas.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  loadEntrantPlayerIds,
  loadNotificationRecipients,
  notifyUsers,
  type NotificationRecipient,
} from "@/lib/server/notify";
import { matchReminderPush, matchScheduleClearedPush } from "@/lib/shared/push-messages";
import {
  MATCH_REMINDER_LOOKAHEAD_MS,
  MATCH_REMINDER_OFFSETS,
  MATCH_SEEN_KEY,
  MATCH_TOLD_KEY,
  MATCH_TOLD_KEYS,
  buildMatchReminderMessage,
  buildMatchScheduleAnnouncement,
  buildMatchScheduleClearedNotice,
  dueMatchReminders,
  matchRoundLabel,
  openedMatchReminders,
  type MatchReminderOffset,
  type ScheduleAnnouncement,
} from "@/lib/shared/discord-notifications";
import { tournamentPageUrl } from "./app-url";

type ScheduledMatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_name: string;
  participant_type: string;
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

/** Les deux engagées d'une manche, chacune face à l'autre. */
function matchSides(match: ScheduledMatchRow): { teamId: number; teamName: string; opponentName: string }[] {
  return [
    { teamId: Number(match.team1_id), teamName: String(match.team1_name), opponentName: String(match.team2_name) },
    { teamId: Number(match.team2_id), teamName: String(match.team2_name), opponentName: String(match.team1_name) },
  ];
}

/**
 * Un envoi retenu : un palier de rappel, l'annonce d'un horaire
 * (`offset === null`), ou l'avis d'un horaire retiré (`clearedStartAt`).
 */
type PlannedSend = {
  match: ScheduledMatchRow;
  offset: MatchReminderOffset | null;
  /** Paliers encore devant, pour dire à quand le prochain rappel (annonce). */
  remaining: MatchReminderOffset[];
  /** Annonce d'une date qui en remplace une autre (« Match reprogrammé »). */
  announcement?: ScheduleAnnouncement;
  /** Horaire retiré par l'arbitrage (« Horaire du match retiré »). */
  clearedStartAt?: string;
};

/**
 * Décide ce qu'il y a à envoyer pour une manche, et **réserve** ce qu'elle
 * décide d'envoyer.
 *
 * Deux régimes, séparés par la marque d'observation (`MATCH_SEEN_KEY`) :
 *
 * - **Première observation.** Le site découvre cette date (une engagée
 *   manquait quand l'arbitre l'a posée, ou a changé depuis) : **annonce**
 *   unique qui porte la date. Un palier déjà ouvert est consommé sans
 *   message — sans cela, la manche ne recevrait qu'un rappel, sans l'annonce
 *   de son horaire.
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

    // Première observation : l'horaire n'a pas été annoncé à ces engagées
    // (`setMatchStartAt` pose la marque quand il annonce) — on l'annonce, quelle
    // que soit l'échéance.
    const opened = openedMatchReminders(match.start_at, now);
    for (const offset of opened) await claimReminder(matchId, offset.key);
    const openedKeys = new Set(opened.map((offset) => offset.key));
    const remaining = MATCH_REMINDER_OFFSETS.filter((offset) => !openedKeys.has(offset.key));
    // Les joueurs avaient déjà reçu un horaire (manche programmée avant la
    // marque d'observation, par exemple) : la date découverte en remplace une.
    const announcement = { rescheduled: MATCH_TOLD_KEYS.some((key) => alreadySent.has(key)) };
    return [{ match, offset: null, remaining: [...remaining], announcement }];
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

/**
 * Envoie un envoi retenu aux deux engagées de la manche.
 *
 * @returns Le nombre de messages déclenchés (un par engagée qui a des destinataires).
 */
async function dispatchPlannedSend(
  { match, offset, remaining, announcement = { rescheduled: false }, clearedStartAt }: PlannedSend,
  recipientsByTeam: Awaited<ReturnType<typeof loadRecipientsByTeam>>,
): Promise<number> {
  let dispatched = 0;
  let delivered = false;
  const roundLabel = matchRoundLabel(String(match.bracket), Number(match.round_number));
  const url = tournamentPageUrl(Number(match.tournament_id));

  // Un message par engagée, pas un pour tout le monde : chaque joueur lit
  // « ton équipe contre l'autre », dans le bon sens.
  for (const side of matchSides(match)) {
    const recipients = recipientsByTeam.get(side.teamId) ?? [];
    if (recipients.length === 0) continue;

    const solo = match.participant_type === "SOLO";
    // Un avis de retrait porte l'horaire qui ne vaut plus.
    const startAt = clearedStartAt ?? match.start_at;
    const context = {
      tournamentName: String(match.tournament_name),
      tournamentUrl: url,
      teamName: side.teamName,
      opponentName: side.opponentName,
      roundLabel,
      startAt,
      solo,
    };
    const pushSide = {
      tournamentId: Number(match.tournament_id),
      tournamentName: context.tournamentName,
      matchId: Number(match.id),
      teamName: side.teamName,
      opponentName: side.opponentName,
      bracket: String(match.bracket),
      roundNumber: Number(match.round_number),
      startAt,
      solo,
    };

    // Le contexte dit au bot (et à ses journaux) de quel message il s'agit.
    let message: string;
    let discordContext: string;
    if (clearedStartAt) {
      message = buildMatchScheduleClearedNotice(context);
      discordContext = "match-schedule-cleared";
    } else if (offset) {
      message = buildMatchReminderMessage(offset, context);
      discordContext = "match-reminder";
    } else {
      message = buildMatchScheduleAnnouncement(context, remaining, announcement);
      discordContext = "match-scheduled";
    }

    const offsetKey = offset ? offset.key : null;
    const report = await notifyUsers(recipients, {
      topic: "MATCH_REMINDER",
      discord: { message, context: discordContext },
      push: (locale) =>
        clearedStartAt
          ? matchScheduleClearedPush(pushSide, locale)
          : matchReminderPush(pushSide, offsetKey, locale, announcement),
    });
    dispatched += 1;
    if ((report.discord?.sent ?? 0) > 0 || report.pushed > 0) delivered = true;
  }
  // Un horaire parti le dit en base : une date posée plus tard se lira
  // « reprogrammée », une date effacée « retirée » (`setMatchStartAt`) — ce que
  // ni la marque d'observation ni celle d'un palier ne prouvent — à condition
  // qu'un message privé ou un push ait réellement abouti. Un avis de
  // retrait n'en pose pas : la marque est déjà là, c'est elle qui l'a permis.
  if (delivered && !clearedStartAt) await claimReminder(Number(match.id), MATCH_TOLD_KEY);
  return dispatched;
}

/** Manches non jouées aux deux engagées connues. */
const MATCH_WITH_ENTRANTS_SELECT = `SELECT m.id, m.tournament_id, m.bracket, m.round_number, m.start_at,
            m.team1_id, m.team2_id,
            t.name AS tournament_name, t.participant_type,
            t1.name AS team1_name, t2.name AS team2_name
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.status <> 'COMPLETED'`;

/**
 * Manches à venir, non jouées, aux deux engagées connues — le balayage y ajoute
 * sa fenêtre de lecture, l'annonce d'un horaire le numéro de la manche.
 */
const SCHEDULED_MATCH_SELECT = `${MATCH_WITH_ENTRANTS_SELECT}
        AND m.start_at IS NOT NULL
        AND m.start_at > NOW()`;

/**
 * Annonce aux joueurs des deux engagées l'horaire qu'un arbitre vient de poser
 * ou de changer (`setMatchStartAt`), **sans attendre** le balayage.
 *
 * Le balayage seul laissait deux trous : il ne passe qu'à la lecture de la
 * liste des tournois, et une date posée au-delà de sa fenêtre de lecture
 * n'était annoncée par rien avant son rappel. Ici
 * l'annonce part tout de suite, quelle que soit l'échéance.
 *
 * L'appelant (`setMatchStartAt`) a effacé les paliers de l'ancienne date et
 * posé lui-même la marque d'observation, **dans le même geste** : un balayage
 * concurrent ne peut donc pas prendre l'annonce pour lui (régime d'annonce
 * fermé), seulement un palier. Les paliers déjà ouverts sont consommés comme au
 * premier passage du balayage ; si l'un d'eux est déjà pris, c'est qu'un
 * balayage vient d'envoyer son rappel — qui porte la nouvelle date — et
 * l'annonce se tait. Les paliers encore devant suivent leur cours.
 *
 * Meilleur effort : rien n'est annoncé pour une manche passée, jouée, ou dont
 * une engagée manque encore (le balayage l'annoncera quand elle sera connue).
 *
 * @param announcement La nouvelle date remplace une date déjà annoncée
 *                     (« Match reprogrammé »), et l'ancienne quand elle est connue.
 * @returns Le nombre de messages déclenchés (un par engagée qui a des destinataires).
 */
export async function announceMatchSchedule(
  matchId: number,
  announcement: ScheduleAnnouncement,
  now: Date = new Date(),
): Promise<number> {
  const db = await getDatabase();
  const [matches] = await db.query<ScheduledMatchRow[]>(`${SCHEDULED_MATCH_SELECT} AND m.id = ? LIMIT 1`, [
    matchId,
  ]);
  const match = matches[0];
  if (!match) return 0;

  const opened = openedMatchReminders(match.start_at, now);
  for (const offset of opened) {
    if (!(await claimReminder(matchId, offset.key))) return 0;
  }
  const openedKeys = new Set(opened.map((offset) => offset.key));
  const remaining = MATCH_REMINDER_OFFSETS.filter((offset) => !openedKeys.has(offset.key));

  const recipientsByTeam = await loadRecipientsByTeam([Number(match.team1_id), Number(match.team2_id)]);
  return dispatchPlannedSend({ match, offset: null, remaining: [...remaining], announcement }, recipientsByTeam);
}

/**
 * Prévient les joueurs des deux engagées qu'un arbitre a **retiré** l'horaire
 * qu'ils avaient reçu (`setMatchStartAt`, l'appelant vérifie la marque
 * {@link MATCH_TOLD_KEY}) : message privé Discord et push, même étiquette que
 * l'annonce qu'il remplace. Les marques restent : la date reposée ensuite se
 * lira « reprogrammée ».
 *
 * @param previousStartAt L'horaire retiré.
 * @returns Le nombre de messages déclenchés (un par engagée qui a des destinataires).
 */
export async function announceMatchScheduleCleared(matchId: number, previousStartAt: string): Promise<number> {
  const db = await getDatabase();
  const [matches] = await db.query<ScheduledMatchRow[]>(`${MATCH_WITH_ENTRANTS_SELECT} AND m.id = ? LIMIT 1`, [
    matchId,
  ]);
  const match = matches[0];
  if (!match) return 0;

  const recipientsByTeam = await loadRecipientsByTeam([Number(match.team1_id), Number(match.team2_id)]);
  return dispatchPlannedSend({ match, offset: null, remaining: [], clearedStartAt: previousStartAt }, recipientsByTeam);
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
  // une manche découverte ici est annoncée une journée avant que son rappel ne
  // s'ouvre, plutôt qu'à sa place.
  const [matches] = await db.query<ScheduledMatchRow[]>(
    `${SCHEDULED_MATCH_SELECT}
        AND m.start_at <= DATE_ADD(NOW(), INTERVAL ? SECOND)`,
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

  for (const send of planned) dispatched += await dispatchPlannedSend(send, recipientsByTeam);

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
