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
  FIRST_SCHEDULE,
  MATCH_REMINDER_LOOKAHEAD_MS,
  MATCH_REMINDER_OFFSETS,
  MATCH_SEEN_KEY,
  MATCH_TOLD_KEY,
  buildMatchReminderMessage,
  buildMatchScheduleAnnouncement,
  buildMatchScheduleClearedNotice,
  dueMatchReminders,
  matchRoundLabel,
  openedMatchReminders,
  type MatchReminderOffset,
  type ScheduleAnnouncement,
} from "@/lib/shared/discord-notifications";
import { inBatches } from "@/lib/shared/in-batches";
import { tournamentPageUrl } from "./app-url";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

/** Un horaire tel que la base le rend (`dateStrings`) ou que le code le passe ; `null` : aucun. */
type MaybeInstant = Date | string | null;

/** Une manche à jouer, ses deux engagées connues. */
type ScheduledMatch = {
  id: number;
  tournament_id: number;
  tournament_name: string;
  participant_type: string;
  bracket: string;
  round_number: number;
  swiss_round: number;
  start_at: string | Date;
  team1_id: number;
  team2_id: number;
  team1_name: string;
  team2_name: string;
};

type ScheduledMatchRow = RowDataPacket & ScheduledMatch;

/**
 * Une manche telle que `schedule-notices` la lit, **une fois** pour tous les
 * avis d'un changement d'horaire (journal, arbitres, joueurs) : places
 * possiblement vides, statut quelconque, horaire possiblement effacé.
 */
export type MatchNotice = Omit<ScheduledMatch, "start_at" | "team1_id" | "team2_id" | "team1_name" | "team2_name"> & {
  status: string;
  start_at: MaybeInstant;
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
};

/**
 * La manche, si elle reste à jouer (aucun score saisi) entre deux engagées
 * connues ; `startAt` : l'horaire qu'annonce le message (`null` : rien).
 */
function playableMatch(row: MatchNotice, startAt: MaybeInstant): ScheduledMatch | null {
  const { team1_id, team2_id, team1_name, team2_name } = row;
  if (team1_id === null || team2_id === null || team1_name === null || team2_name === null) return null;
  if (startAt === null || row.status === "COMPLETED" || row.status === "AWAITING_CONFIRMATION") return null;
  return { ...row, team1_id, team2_id, team1_name, team2_name, start_at: startAt };
}

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

/** Manches envoyées en même temps par un balayage. */
const SWEEP_CONCURRENCY = 4;

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
 * Réserve un palier pour une manche — **pour l'horaire lu** : la réservation
 * échoue si l'horaire a changé depuis la lecture (un arbitre l'a déplacé entre
 * la lecture du balayage et son envoi). Sans cette condition, le balayage
 * enverrait l'ancien horaire et prendrait le palier que l'annonce du nouveau
 * attend — qui se tairait. L'`INSERT … SELECT` lit la ligne du match sous
 * verrou partagé : une programmation en cours est attendue, puis relue.
 *
 * @returns `true` si la réservation est acquise (c'est à nous d'envoyer),
 *          `false` si une autre requête l'a prise entre-temps, ou si
 *          l'horaire n'est plus celui-là.
 */
async function claimReminder(match: ScheduledMatch, offsetKey: string): Promise<boolean> {
  const db = await getDatabase();
  const matchId = Number(match.id);
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_match_reminders (match_id, offset_key)
       SELECT ?, ? FROM bg_matches WHERE id = ? AND start_at = ?`,
    [matchId, offsetKey, matchId, match.start_at],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/**
 * La marque d'horaire reçu pendant un envoi : posée (ou mise à jour) **avant**
 * l'envoi — un arbitre qui corrige sa saisie dans la seconde lit déjà le nouvel
 * horaire —, puis rendue à son état d'avant si rien n'a abouti.
 */
type ToldMark = { matchId: number; claimed: boolean; previous: Date | null; unchanged: boolean };

type ToldStateRow = RowDataPacket & {
  match_start_at: MaybeInstant;
  told_id: number | null;
  start_at: MaybeInstant;
};

/** Même instant, `null` compris (une chaîne `dateStrings` ou une `Date`). */
function sameInstant(a: MaybeInstant, b: MaybeInstant): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** Rien à poser, rien à rendre : la marque reste telle quelle. */
const UNTOUCHED = (matchId: number): ToldMark => ({ matchId, claimed: false, previous: null, unchanged: true });

/**
 * Pose la marque avec l'horaire envoyé (`null` pour un avis de retrait : les
 * joueurs ne tiendront plus d'horaire). Une marque déjà là garde de quoi être
 * rendue. `null` : personne à prévenir.
 *
 * Relit au passage l'horaire **actuel** de la manche : un arbitre qui l'a
 * déplacé (ou retiré, ou reposé) depuis la lecture de l'envoi a fait partir sa
 * propre annonce — envoyer celle-ci dirait aux joueurs un horaire périmé.
 *
 * @param sentStart L'horaire que l'envoi annonce (`null` : un avis de retrait,
 *                  la manche ne doit plus en avoir).
 * @returns `"stale"` : l'horaire a changé, rien ne doit partir.
 */
async function openToldMark(
  match: ScheduledMatch,
  recipientsByTeam: Map<number, NotificationRecipient[]>,
  sentStart: Date | null,
): Promise<ToldMark | null | "stale"> {
  const hasRecipients = matchSides(match).some((side) => (recipientsByTeam.get(side.teamId) ?? []).length > 0);
  if (!hasRecipients) return null;
  const matchId = Number(match.id);
  const db = await getDatabase();
  const [rows] = await db.execute<ToldStateRow[]>(
    `SELECT m.start_at AS match_start_at, r.id AS told_id, r.start_at
       FROM bg_matches m
       LEFT JOIN bg_match_reminders r ON r.match_id = m.id AND r.offset_key = ?
      WHERE m.id = ? LIMIT 1`,
    [MATCH_TOLD_KEY, matchId],
  );
  const state = rows[0];
  if (!state || !sameInstant(state.match_start_at, sentStart)) return "stale";
  if (state.told_id === null) {
    // Un avis de retrait suppose la marque : sans elle, rien à poser.
    if (sentStart === null) return null;
    // Perdue au profit d'un envoi concurrent : celui-ci n'a rien écrit, il n'a
    // rien à rendre — sans quoi il effacerait l'horaire que l'autre a remis.
    if (!(await claimToldMark(matchId, sentStart))) return UNTOUCHED(matchId);
    return { matchId, claimed: true, previous: null, unchanged: false };
  }
  const previous = state.start_at === null ? null : new Date(state.start_at);
  // Le rappel 24 h d'un horaire déjà reçu : la marque tient déjà cet horaire,
  // rien à écrire — ni à rendre si rien n'aboutit.
  if (sameInstant(previous, sentStart)) return UNTOUCHED(matchId);
  await setToldTime(matchId, sentStart);
  return { matchId, claimed: false, previous, unchanged: false };
}

/** Referme la marque après l'envoi : rien n'a abouti, elle reprend son état d'avant. */
async function closeToldMark(told: ToldMark | null, delivered: boolean): Promise<void> {
  if (!told || delivered || told.unchanged) return;
  if (told.claimed) await releaseReminder(told.matchId, MATCH_TOLD_KEY);
  else await setToldTime(told.matchId, told.previous);
}

/** L'horaire que les joueurs tiennent (`null` : aucun, après un retrait). */
async function setToldTime(matchId: number, startAt: Date | null): Promise<void> {
  const db = await getDatabase();
  await db.execute(`UPDATE bg_match_reminders SET start_at = ? WHERE match_id = ? AND offset_key = ?`, [
    startAt,
    matchId,
    MATCH_TOLD_KEY,
  ]);
}

/** Réserve la marque d'horaire reçu, avec l'horaire envoyé. `false` : elle existait. */
async function claimToldMark(matchId: number, startAt: Date): Promise<boolean> {
  const db = await getDatabase();
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at) VALUES (?, ?, ?)`,
    [matchId, MATCH_TOLD_KEY, startAt],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/** Rend une marque réservée pour un envoi qui n'a rien donné. */
async function releaseReminder(matchId: number, offsetKey: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key = ?`, [matchId, offsetKey]);
}

/** Les deux engagées d'une manche, chacune face à l'autre. */
function matchSides(match: ScheduledMatch): { teamId: number; teamName: string; opponentName: string }[] {
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
  match: ScheduledMatch;
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
  match: ScheduledMatch,
  now: Date,
  alreadySent: Set<string>,
): Promise<PlannedSend[]> {
  if (!alreadySent.has(MATCH_SEEN_KEY)) {
    // La marque d'observation fait aussi office de verrou : seule la requête
    // qui la pose annonce, les concurrentes laissent la manche pour le passage
    // suivant.
    if (!(await claimReminder(match, MATCH_SEEN_KEY))) return [];

    // Première observation : l'horaire n'a pas été annoncé à ces engagées
    // (`setMatchStartAt` pose la marque quand il annonce) — on l'annonce, quelle
    // que soit l'échéance.
    const opened = openedMatchReminders(match.start_at, now);
    for (const offset of opened) await claimReminder(match, offset.key);
    const openedKeys = new Set(opened.map((offset) => offset.key));
    const remaining = MATCH_REMINDER_OFFSETS.filter((offset) => !openedKeys.has(offset.key));
    // Les joueurs avaient déjà reçu un horaire (manche programmée avant la
    // marque d'observation, par exemple) : la date découverte en remplace une.
    const announcement = { rescheduled: alreadySent.has(MATCH_TOLD_KEY) };
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
    if (await claimReminder(match, offset.key)) {
      planned.push({ match, offset, remaining: [] });
    }
  }
  return planned;
}

/** Une engagée de la manche, face à l'autre. */
type MatchSide = ReturnType<typeof matchSides>[number];

/**
 * Le message d'un envoi pour une engagée : message privé Discord (français) et
 * push dans la langue de chaque destinataire.
 *
 * @returns L'envoi a-t-il atteint quelqu'un (message privé remis, ou appareil) ?
 */
async function sendToSide(
  { match, offset, remaining, announcement = FIRST_SCHEDULE, clearedStartAt }: PlannedSend,
  side: MatchSide,
  recipients: NotificationRecipient[],
): Promise<boolean> {
  const swiss = isSwissRound(match);
  const solo = match.participant_type === "SOLO";
  // Un avis de retrait porte l'horaire qui ne vaut plus.
  const startAt = clearedStartAt ?? match.start_at;
  const context = {
    tournamentName: String(match.tournament_name),
    tournamentUrl: tournamentPageUrl(Number(match.tournament_id)),
    teamName: side.teamName,
    opponentName: side.opponentName,
    roundLabel: matchRoundLabel(String(match.bracket), Number(match.round_number), swiss),
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
    swiss,
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
  return (report.discord?.sent ?? 0) > 0 || report.pushed > 0;
}

/**
 * Envoie un envoi retenu aux deux engagées de la manche, **en même temps** :
 * chacune attend le bot puis ses appareils, rien ne lie l'une à l'autre.
 *
 * @returns Le nombre de messages déclenchés (un par engagée qui a des destinataires).
 */
async function dispatchPlannedSend(
  send: PlannedSend,
  recipientsByTeam: Awaited<ReturnType<typeof loadRecipientsByTeam>>,
): Promise<number> {
  const { match, clearedStartAt } = send;
  // Un horaire parti le dit en base, avec l'horaire envoyé : une date posée
  // plus tard se lira « reprogrammée, au lieu du … », une date effacée
  // « retirée » (`setMatchStartAt`) — ce que ni la marque d'observation ni
  // celle d'un palier ne prouvent. Posée **avant** l'envoi (un arbitre qui
  // corrige sa saisie dans la seconde la lit déjà), rendue à son état d'avant
  // si rien n'a abouti — même sur une erreur. Un avis de retrait la garde,
  // sans horaire.
  const told = await openToldMark(match, recipientsByTeam, clearedStartAt ? null : new Date(match.start_at));
  if (told === "stale") return 0;

  // Un message par engagée, pas un pour tout le monde : chaque joueur lit
  // « ton équipe contre l'autre », dans le bon sens.
  const targets = matchSides(match)
    .map((side) => ({ side, recipients: recipientsByTeam.get(side.teamId) ?? [] }))
    .filter(({ recipients }) => recipients.length > 0);
  const results = await Promise.allSettled(
    targets.map(({ side, recipients }) => sendToSide(send, side, recipients)),
  );
  // Une engagée atteinte suffit : l'horaire est reçu, même si l'autre envoi a
  // échoué. Rien d'atteint (ou tout en échec) : la marque reprend son état.
  await closeToldMark(
    told,
    results.some((result) => result.status === "fulfilled" && result.value),
  );
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
  return targets.length;
}

/**
 * Manches non jouées aux deux engagées connues. Un score déjà saisi
 * (`AWAITING_CONFIRMATION`) dit que la rencontre a eu lieu : rien à annoncer.
 */
const MATCH_WITH_ENTRANTS_SELECT = `SELECT m.id, m.tournament_id, m.bracket, m.round_number, m.start_at,
            m.team1_id, m.team2_id,
            t.name AS tournament_name, t.participant_type, ${swissRoundSql("m", "t")},
            t1.name AS team1_name, t2.name AS team2_name
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.status NOT IN ('COMPLETED', 'AWAITING_CONFIRMATION')`;

/**
 * Manches à venir, non jouées, aux deux engagées connues — le balayage y ajoute
 * sa fenêtre de lecture (index `idx_bg_matches_start_at`).
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
 * @param notice La manche, lue une fois par l'appelant pour tous ses avis.
 * @param announcement La nouvelle date remplace une date déjà annoncée
 *                     (« Match reprogrammé »), et l'ancienne quand elle est connue.
 * @returns Le nombre de messages déclenchés (un par engagée qui a des destinataires).
 */
export async function announceMatchSchedule(
  notice: MatchNotice,
  announcement: ScheduleAnnouncement,
  now: Date = new Date(),
): Promise<number> {
  const match = playableMatch(notice, notice.start_at);
  if (!match || new Date(match.start_at).getTime() <= now.getTime()) return 0;

  const opened = openedMatchReminders(match.start_at, now);
  for (const offset of opened) {
    if (!(await claimReminder(match, offset.key))) return 0;
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
 * @param notice La manche, lue une fois par l'appelant pour tous ses avis.
 * @param previousStartAt L'horaire retiré.
 * @returns Le nombre de messages déclenchés (un par engagée qui a des destinataires).
 */
export async function announceMatchScheduleCleared(notice: MatchNotice, previousStartAt: string): Promise<number> {
  // L'horaire de la manche est effacé : celui que porte l'avis est le retiré.
  const match = playableMatch(notice, previousStartAt);
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
  // qu'elle est censée fermer. Quelques manches à la fois : une ronde suisse
  // fraîchement appariée en réserve des dizaines.
  const planned: PlannedSend[] = [];
  await inBatches(matches, SWEEP_CONCURRENCY, async (match) => {
    // Une réservation en échec (attente de verrou, interblocage) ne retient pas
    // les autres manches : celles déjà réservées doivent partir, sans quoi leur
    // palier serait consommé sans message. Celle-ci réessaiera au passage suivant.
    try {
      planned.push(...(await planMatchSends(match, now, sentByMatch.get(Number(match.id)) ?? new Set())));
    } catch (error) {
      console.error("[match-reminders] réservation de rappel en échec", error);
    }
  });
  if (planned.length === 0) return 0;

  const teamIds = [
    ...new Set(planned.flatMap(({ match }) => [Number(match.team1_id), Number(match.team2_id)])),
  ];
  const recipientsByTeam = await loadRecipientsByTeam(teamIds);

  // Quelques manches à la fois : chaque envoi attend le bot puis les appareils,
  // et une ronde suisse appariée sur des horaires déjà posés en annonce d'un
  // coup toutes les manches. Les réservations, déjà prises, interdisent le
  // doublon quel que soit l'ordre.
  let dispatched = 0;
  await inBatches(planned, SWEEP_CONCURRENCY, async (send) => {
    // Un envoi qui échoue ne retient pas les autres : leurs réservations sont
    // déjà prises, et un passage interrompu les perdrait pour de bon.
    try {
      // Lu après l'attente : `dispatched += await …` lirait le compteur avant,
      // et perdrait les envois concurrents du même lot.
      const sent = await dispatchPlannedSend(send, recipientsByTeam);
      dispatched += sent;
    } catch (error) {
      console.error("[match-reminders] envoi de rappel en échec", error);
    }
  });
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
