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
  pushDiscordDirectMessages,
  type DiscordRecipient,
} from "@/lib/server/bot-integration";
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

type RecipientRow = RowDataPacket & {
  team_id: number;
  pseudo: string;
  discord_id: string | null;
  discord_pseudo: string | null;
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
 * Destinataire Discord d'un joueur.
 *
 * Le tag suffit — le bot résout le membre sur le serveur BlueGenji. L'ID, quand
 * le compte a été lié par code Discord, évite ce balayage et reste donc
 * prioritaire.
 */
function toRecipient(row: RecipientRow): DiscordRecipient | null {
  if (!row.discord_id && !row.discord_pseudo) return null;
  return {
    discordId: row.discord_id,
    handle: row.discord_pseudo,
    label: row.pseudo,
  };
}

/**
 * Joueurs des engagées d'un match, par engagée.
 *
 * Deux origines réunies : les membres actifs d'une équipe, et le joueur d'une
 * entrée solo (`bg_teams.solo_user_id`), qui n'a pas de ligne de membre — c'est
 * la même distinction qu'ailleurs dans le moteur, un engagé n'étant pas
 * forcément une équipe (`lib/shared/participants.ts`).
 */
async function loadRecipientsByTeam(
  teamIds: number[],
): Promise<Map<number, DiscordRecipient[]>> {
  const byTeam = new Map<number, DiscordRecipient[]>();
  if (teamIds.length === 0) return byTeam;

  const db = await getDatabase();
  const placeholders = teamIds.map(() => "?").join(", ");
  const [rows] = await db.query<RecipientRow[]>(
    `SELECT tm.team_id AS team_id, u.pseudo, u.discord_id, u.discord_pseudo
       FROM bg_team_members tm
       JOIN bg_users u ON u.id = tm.user_id
      WHERE tm.team_id IN (${placeholders})
        AND tm.left_at IS NULL
      UNION
     SELECT t.id AS team_id, u.pseudo, u.discord_id, u.discord_pseudo
       FROM bg_teams t
       JOIN bg_users u ON u.id = t.solo_user_id
      WHERE t.id IN (${placeholders})`,
    [...teamIds, ...teamIds],
  );

  for (const row of rows) {
    const recipient = toRecipient(row);
    if (!recipient) continue;
    const teamId = Number(row.team_id);
    const list = byTeam.get(teamId);
    if (list) list.push(recipient);
    else byTeam.set(teamId, [recipient]);
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

      await pushDiscordDirectMessages(
        message,
        recipients,
        offset ? "match-reminder" : "match-scheduled",
      );
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
