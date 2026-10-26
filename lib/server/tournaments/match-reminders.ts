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
 * consomme le palier — ce rappel-là est perdu (il en reste deux : 24 h, puis
 * 10 h, qui porte le check-in).
 * C'est le bon sens du risque — un rappel manqué ne s'excuse qu'une fois, un
 * rappel envoyé en boucle ne se rattrape pas.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { sqlPlaceholders } from "@/lib/server/sql-placeholders";
import {
  loadEntrantPlayerIds,
  loadNotificationRecipients,
  notifyUsers,
  type NotificationRecipient,
} from "@/lib/server/notify";
import { usersReachableByPush } from "@/lib/server/push-subscriptions";
import { matchReminderPush, matchScheduleClearedPush, matchWithdrawnPush, pushRoundLabel } from "@/lib/shared/push-messages";
import type { LocalizedDm } from "@/lib/shared/dm-language";
import {
  CHECK_IN_REMINDER_KEY,
  FIRST_SCHEDULE,
  MATCH_REMINDER_LOOKAHEAD_MS,
  MATCH_REMINDER_OFFSETS,
  MATCH_SEEN_KEY,
  MATCH_TOLD_KEY,
  buildMatchReminderMessage,
  isCheckInOpen,
  buildMatchScheduleAnnouncement,
  buildMatchScheduleClearedNotice,
  buildMatchWithdrawnNotice,
  dueMatchReminders,
  matchRoundLabel,
  openedMatchReminders,
  type MatchReminderOffset,
  type ScheduleAnnouncement,
  MATCH_DM_SETTINGS_PATH,
} from "@/lib/shared/discord-notifications";
import { inBatches } from "@/lib/shared/in-batches";
import { PLAYED_MATCH_STATUSES, isPlayedMatchStatus } from "@/lib/shared/match-schedule";
import { siteUrl } from "@/lib/server/site-url";
import { tournamentPageUrl } from "./app-url";
import { onPoster, toPoster, type PosterRow } from "./match-poster";
import { dispatchRefereeDigest } from "./referee-digest";
import { claimDatedMark, releaseDatedMarks } from "./reminder-marks";
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
  if (startAt === null || isPlayedMatchStatus(row.status)) return null;
  return { ...row, team1_id, team2_id, team1_name, team2_name, start_at: startAt };
}

/** Une manche lue par le balayage, avec ses marques d'observation et d'horaire reçu. */
type SweepMatchRow = ScheduledMatchRow & { seen_mark: number; told_mark: number };

/**
 * Étranglement du balayage.
 *
 * Une minute : les paliers se comptent en heures, un rappel décalé d'une minute
 * ne se remarque pas, et le site tourne sur un Raspberry Pi — repasser sur le
 * calendrier à chaque lecture de `/tournois` serait payer cher une précision
 * dont personne n'a l'usage.
 */
const SWEEP_THROTTLE_MS = 60_000;

/** Le palier le plus proche du coup d'envoi : pris, le cycle de rappels est fini. */
const LAST_REMINDER_KEY = [...MATCH_REMINDER_OFFSETS].sort((a, b) => a.minutesBefore - b.minutesBefore)[0].key;

/**
 * Paliers suivis d'un autre, avec l'ouverture du suivant (secondes avant le
 * coup d'envoi) : tant que le suivant n'est pas ouvert, une manche dont ce
 * palier est déjà pris n'a rien à recevoir — le balayage ne la relit pas
 * (sans quoi chaque manche entre 24 h et 10 h serait relue, et sa marque
 * « 24 h » re-tentée, à chaque passage pendant 14 heures).
 */
const WAITING_OFFSETS = [...MATCH_REMINDER_OFFSETS]
  .sort((a, b) => b.minutesBefore - a.minutesBefore)
  .flatMap((offset, index, sorted) =>
    index + 1 < sorted.length ? [{ key: offset.key, nextOpensSeconds: sorted[index + 1].minutesBefore * 60 }] : [],
  );

/** Avance du premier palier (le plus lointain) : avant, une manche observée n'a rien de dû. */
const FIRST_REMINDER_LEAD_SECONDS = Math.max(...MATCH_REMINDER_OFFSETS.map((offset) => offset.minutesBefore)) * 60;

/** Manches envoyées en même temps par un balayage. */
const SWEEP_CONCURRENCY = 4;

let lastSweepAt = 0;
let pendingSweep: Promise<number> | null = null;
/** Programme d'arbitrage en cours : son propre verrou, distinct du balayage. */
let pendingDigest: Promise<void> | null = null;
/** Fin du dernier programme : son propre étranglement (une minute aussi). */
let lastDigestAt = 0;

/**
 * Lance le programme d'arbitrage s'il n'est ni en cours ni passé depuis moins
 * d'une minute — **avant** le verrou du balayage : un balayage long (ronde
 * suisse annoncée d'un coup, bot lent) ne le retient pas, ni l'inverse (les
 * appareils du staff ne retardent pas les rappels des joueurs). Indépendant :
 * son échec ne retient pas les rappels.
 */
function startRefereeDigest(now: Date): void {
  if (pendingDigest || Date.now() - lastDigestAt < SWEEP_THROTTLE_MS) return;
  pendingDigest = (async () => {
    try {
      await dispatchRefereeDigest(now);
    } catch (error) {
      // Table absente (création avalée au démarrage) : rien à dire à chaque passage.
      if (!isMissingTableError(error)) console.error("[match-reminders] programme d'arbitrage en échec", error);
    } finally {
      lastDigestAt = Date.now();
      pendingDigest = null;
    }
  })();
}

/**
 * Destinataires d'un match, par engagée.
 *
 * Seul un tag Discord **certifié** reçoit un message privé (`certified`) : un
 * tag saisi à la main, jamais prouvé, n'en reçoit aucun (lutte contre le
 * spam). L'ID du compte certifié évite au bot de balayer le serveur et reste
 * prioritaire. Un joueur sans tag certifié reste un destinataire : il peut
 * avoir un appareil abonné aux notifications push.
 */
async function loadRecipientsByTeam(
  teamIds: number[],
): Promise<Map<number, NotificationRecipient[]>> {
  const playersByTeam = await loadEntrantPlayerIds(teamIds);
  // `matchDm` : un joueur opposé aux messages privés de match n'a pas de canal
  // Discord ici — il reste atteignable par push s'il y est abonné.
  const recipients = await loadNotificationRecipients(
    [...playersByTeam.values()].flat(),
    "certified",
    { matchDm: true },
  );
  // Seuls comptent les joueurs qu'un message atteindrait : un tag Discord certifié, ou
  // un appareil abonné aux rappels. Une engagée sans aucun ne pose pas la
  // marque d'horaire reçu (qui ferait dire « reprogrammé » à des joueurs qui
  // n'ont rien reçu), et ne coûte ni écriture ni lecture d'abonnements.
  const withoutDiscord = recipients.filter((recipient) => recipient.discord === null).map((r) => r.userId);
  let pushable: Set<number>;
  try {
    pushable = await usersReachableByPush(withoutDiscord, "MATCH_REMINDER");
  } catch (error) {
    // Lecture en échec : chacun est tenu pour atteignable, comme avant ce
    // filtre — perdre le message privé d'un joueur pour une lecture
    // d'abonnements serait pire qu'une marque posée de trop.
    console.error("[match-reminders] abonnements push illisibles", error);
    pushable = new Set(withoutDiscord);
  }
  const reachable = recipients.filter((recipient) => recipient.discord !== null || pushable.has(recipient.userId));
  const byUser = new Map(reachable.map((recipient) => [recipient.userId, recipient]));
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

/**
 * Clés déjà posées pour une manche du balayage, lues par sa requête même : la
 * manche n'y est que si son dernier palier n'est pas pris, il ne reste donc à
 * savoir que l'observation et l'horaire reçu.
 */
function sentKeysOf(row: SweepMatchRow): Set<string> {
  const keys = new Set<string>();
  if (Number(row.seen_mark) === 1) keys.add(MATCH_SEEN_KEY);
  if (Number(row.told_mark) === 1) keys.add(MATCH_TOLD_KEY);
  return keys;
}

/**
 * La marque d'horaire reçu pendant un envoi : posée (ou mise à jour) **avant**
 * l'envoi — un arbitre qui corrige sa saisie dans la seconde lit déjà le nouvel
 * horaire —, puis rendue à son état d'avant si rien n'a abouti.
 */
type ToldMark = {
  matchId: number;
  claimed: boolean;
  previous: Date | null;
  unchanged: boolean;
  /** L'horaire que cet envoi a écrit : la marque n'est rendue que si elle le porte encore. */
  sent: Date | null;
};

type ToldStateRow = RowDataPacket & {
  match_start_at: MaybeInstant;
  match_team1_id: number | null;
  match_team2_id: number | null;
  told_id: number | null;
  start_at: MaybeInstant;
};

/** La manche relue a toujours les engagées de l'envoi. */
function samePoster(state: ToldStateRow, match: ScheduledMatch): boolean {
  return (
    Number(state.match_team1_id) === Number(match.team1_id) && Number(state.match_team2_id) === Number(match.team2_id)
  );
}

/** Même instant, `null` compris (une chaîne `dateStrings` ou une `Date`). */
function sameInstant(a: MaybeInstant, b: MaybeInstant): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** Rien à poser, rien à rendre : la marque reste telle quelle. */
const UNTOUCHED = (matchId: number): ToldMark => ({
  matchId,
  claimed: false,
  previous: null,
  unchanged: true,
  sent: null,
});

/**
 * Pose la marque avec l'horaire envoyé (`null` pour un avis de retrait : les
 * joueurs ne tiendront plus d'horaire). Une marque déjà là garde de quoi être
 * rendue. `null` : personne à prévenir.
 *
 * Relit au passage l'horaire et les engagées **actuels** de la manche : un
 * arbitre qui l'a déplacée (ou en a retiré, ou reposé l'horaire) depuis la
 * lecture de l'envoi a fait partir sa propre annonce — envoyer celle-ci dirait
 * aux joueurs un horaire périmé ; une engagée remplacée entre-temps (correction
 * de score) n'a rien à recevoir de l'ancienne affiche.
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
    `SELECT m.start_at AS match_start_at, m.team1_id AS match_team1_id, m.team2_id AS match_team2_id,
            r.id AS told_id, r.start_at
       FROM bg_matches m
       LEFT JOIN bg_match_reminders r ON r.match_id = m.id AND r.offset_key = ?
      WHERE m.id = ? LIMIT 1`,
    [MATCH_TOLD_KEY, matchId],
  );
  const state = rows[0];
  if (!state || !sameInstant(state.match_start_at, sentStart) || !samePoster(state, match)) return "stale";
  if (state.told_id === null) {
    // Un avis de retrait suppose la marque : effacée depuis (affiche changée,
    // retour en arrière), personne ne tient plus cet horaire — rien ne part.
    if (sentStart === null) return "stale";
    // Rien d'écrit : la manche a changé depuis la lecture (ou la marque vient
    // d'être posée par un autre envoi) — rien ne part d'ici, et rien n'est à
    // rendre. Deux envois d'un même horaire ne coexistent pas : les
    // réservations (observation, palier) en laissent passer un seul.
    // L'horaire envoyé est celui de la manche (vérifié juste au-dessus) : la
    // marque le recopie de la manche, sous la même condition que tout palier.
    if (!(await claimDatedMark(match, MATCH_TOLD_KEY))) return "stale";
    return { matchId, claimed: true, previous: null, unchanged: false, sent: sentStart };
  }
  const previous = state.start_at === null ? null : new Date(state.start_at);
  // Le rappel 24 h d'un horaire déjà reçu : la marque tient déjà cet horaire,
  // rien à écrire — ni à rendre si rien n'aboutit.
  if (sameInstant(previous, sentStart)) return UNTOUCHED(matchId);
  if (!(await setToldTime(match, sentStart))) return "stale";
  return { matchId, claimed: false, previous, unchanged: false, sent: sentStart };
}

/**
 * Referme la marque après l'envoi : rien n'a abouti, elle reprend son état
 * d'avant — **seulement si elle porte encore l'horaire de cet envoi**. Un
 * changement plus récent, entre-temps remis aux joueurs, y a écrit le sien :
 * le rendre l'effacerait (et le retrait suivant se tairait, ou citerait un
 * horaire faux).
 */
async function closeToldMark(told: ToldMark | null, delivered: boolean): Promise<void> {
  if (!told || delivered || told.unchanged) return;
  const db = await getDatabase();
  if (told.claimed) {
    await db.execute(
      `DELETE FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? AND start_at <=> ?`,
      [told.matchId, MATCH_TOLD_KEY, told.sent],
    );
  } else {
    await db.execute(
      `UPDATE bg_match_reminders SET start_at = ? WHERE match_id = ? AND offset_key = ? AND start_at <=> ?`,
      [told.previous, told.matchId, MATCH_TOLD_KEY, told.sent],
    );
  }
}

/** L'horaire que les joueurs tiennent (`null` : aucun, après un retrait). */
async function setToldTime(match: ScheduledMatch, startAt: Date | null): Promise<boolean> {
  const db = await getDatabase();
  const matchId = Number(match.id);
  // Écrite seulement si la manche porte encore cet horaire et ces engagées : la
  // condition est dans l'écriture même, pas dans une lecture qui la précède.
  // (Elle ne départage pas deux envois du même horaire — `FOUND_ROWS` compte
  // une ligne réécrite à l'identique — : ce sont les réservations qui
  // n'en laissent passer qu'un.)
  // La manche est lue **avant** la marque (`INSERT … SELECT`), dans l'ordre de
  // verrouillage du moteur — un `UPDATE … JOIN` pouvait tenir la marque en
  // attendant la manche, et s'interbloquer avec `setMatchStartAt`.
  const [result] = await db.execute(
    `INSERT INTO bg_match_reminders (match_id, offset_key, start_at)
       SELECT ?, ?, ? FROM bg_matches
        WHERE id = ? AND start_at <=> ? AND team1_id = ? AND team2_id = ?
     ON DUPLICATE KEY UPDATE start_at = ?`,
    [matchId, MATCH_TOLD_KEY, startAt, matchId, startAt, Number(match.team1_id), Number(match.team2_id), startAt],
  );
  return ((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
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
  /**
   * Marques réservées pour cet envoi : rendues s'il échoue avant d'atteindre
   * les joueurs (sans quoi le palier, ou l'annonce, serait consommé sans
   * message et jamais retenté).
   */
  claimed?: string[];
  /** Instant de référence de l'envoi (check-in déjà ouvert ?) ; absent : maintenant. */
  now?: Date;
  /** Horloge murale à la préparation : `now` avancé du temps écoulé depuis (`sentAt`). */
  plannedAt?: number;
};

/**
 * Instant d'un envoi : `now` (injecté par les tests) avancé du temps passé
 * depuis la préparation — une ronde suisse annoncée d'un coup part par lots,
 * et les derniers messages sortent parfois minutes après le début du passage.
 */
function sentAt({ now, plannedAt }: Pick<PlannedSend, "now" | "plannedAt">): Date {
  if (!now) return new Date();
  return new Date(now.getTime() + Math.max(0, Date.now() - (plannedAt ?? Date.now())));
}

/** Rend les marques d'un envoi qui n'a pu partir. Ne lève jamais. */
async function releaseClaims(send: PlannedSend): Promise<void> {
  await releaseDatedMarks(Number(send.match.id), send.claimed ?? [], send.match.start_at);
}

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
    if (!(await claimDatedMark(match, MATCH_SEEN_KEY))) return [];

    // Première observation : l'horaire n'a pas été annoncé à ces engagées
    // (`setMatchStartAt` pose la marque quand il annonce) — on l'annonce, quelle
    // que soit l'échéance.
    const opened = openedMatchReminders(match.start_at, now);
    const claimed = [MATCH_SEEN_KEY];
    try {
      for (const offset of opened) {
        if (await claimDatedMark(match, offset.key)) claimed.push(offset.key);
      }
    } catch (error) {
      // Rendue, l'observation laisse l'annonce au passage suivant ; gardée,
      // elle la ferait taire pour de bon (seul le rappel 24 h partirait).
      await releaseDatedMarks(Number(match.id), [MATCH_SEEN_KEY], match.start_at);
      throw error;
    }
    const openedKeys = new Set(opened.map((offset) => offset.key));
    const remaining = MATCH_REMINDER_OFFSETS.filter((offset) => !openedKeys.has(offset.key));
    // Les joueurs avaient déjà reçu un horaire (manche programmée avant la
    // marque d'observation, par exemple) : la date découverte en remplace une.
    const announcement = { rescheduled: alreadySent.has(MATCH_TOLD_KEY) };
    return [{ match, offset: null, remaining: [...remaining], announcement, claimed, now, plannedAt: Date.now() }];
  }

  // `alreadySent` porte aussi la marque d'observation, qui n'est pas un palier :
  // on ne transmet que les clés qui en sont.
  const sentOffsets = MATCH_REMINDER_OFFSETS.map((offset) => offset.key).filter((key) =>
    alreadySent.has(key),
  );
  const due = dueMatchReminders(match.start_at, now, sentOffsets);

  const planned: PlannedSend[] = [];
  for (const offset of due) {
    if (await claimDatedMark(match, offset.key)) {
      planned.push({ match, offset, remaining: [], claimed: [offset.key], now, plannedAt: Date.now() });
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
  { match, offset, remaining, announcement = FIRST_SCHEDULE, clearedStartAt, now, plannedAt }: PlannedSend,
  side: MatchSide,
  recipients: NotificationRecipient[],
): Promise<boolean> {
  const swiss = isSwissRound(match);
  const solo = match.participant_type === "SOLO";
  // Un avis de retrait porte l'horaire qui ne vaut plus.
  const startAt = clearedStartAt ?? match.start_at;
  // Le check-in : le rappel de 10 h, ou l'annonce qui a consommé son palier
  // (manche programmée moins de 10 h avant) — jamais un avis de retrait.
  let checkIn = false;
  if (!clearedStartAt) {
    checkIn = offset
      ? offset.key === CHECK_IN_REMINDER_KEY
      : !remaining.some((pending) => pending.key === CHECK_IN_REMINDER_KEY);
  }
  // À l'instant de l'envoi, pas du début du passage : un lot parti après
  // l'ouverture du salon ne doit plus dire qu'il « ouvre 15 minutes avant ».
  const checkInOpen = checkIn && isCheckInOpen(startAt, sentAt({ now, plannedAt }));
  const context = {
    tournamentName: String(match.tournament_name),
    tournamentUrl: tournamentPageUrl(Number(match.tournament_id)),
    matchDmSettingsUrl: siteUrl(MATCH_DM_SETTINGS_PATH),
    teamName: side.teamName,
    opponentName: side.opponentName,
    roundLabel: matchRoundLabel(String(match.bracket), Number(match.round_number), swiss),
    roundLabelEn: pushRoundLabel(String(match.bracket), Number(match.round_number), "en", swiss),
    startAt,
    solo,
    checkIn,
    checkInOpen,
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
    checkIn,
    checkInOpen,
  };

  // Le contexte dit au bot (et à ses journaux) de quel message il s'agit.
  // Rédigé dans la langue de chaque destinataire (`notifyUsers`).
  let message: LocalizedDm;
  let discordContext: string;
  if (clearedStartAt) {
    message = (locale) => buildMatchScheduleClearedNotice(context, locale);
    discordContext = "match-schedule-cleared";
  } else if (offset) {
    message = (locale) => buildMatchReminderMessage(offset, context, locale);
    discordContext = "match-reminder";
  } else {
    message = (locale) => buildMatchScheduleAnnouncement(context, remaining, announcement, locale);
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
  let told: Awaited<ReturnType<typeof openToldMark>>;
  try {
    told = await openToldMark(match, recipientsByTeam, clearedStartAt ? null : new Date(match.start_at));
  } catch (error) {
    // Attente de verrou, interblocage : rien n'est parti, les marques de cet
    // envoi sont rendues — le passage suivant le retentera.
    await releaseClaims(send);
    throw error;
  }
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
  try {
    await closeToldMark(
      told,
      results.some((result) => result.status === "fulfilled" && result.value),
    );
  } catch (error) {
    // La marque garde l'horaire écrit avant l'envoi : pm2 le dit, et l'échec
    // de l'envoi lui-même reste celui qui remonte.
    console.error("[match-reminders] marque d'horaire reçu non rendue", error);
  }
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
  return targets.length;
}

/**
 * Manches du balayage : à venir, non jouées (un score déjà saisi,
 * `AWAITING_CONFIRMATION`, dit que la rencontre a eu lieu), aux deux engagées
 * connues, avec leurs marques d'observation et d'horaire reçu (clé unique).
 * Le balayage y ajoute sa fenêtre de lecture (index `idx_bg_matches_start_at`).
 * Paramètres : clé d'observation, clé d'horaire reçu, instant présent.
 *
 * Toutes les bornes sont des instants **calculés ici** (`now`), jamais
 * `NOW()` : les horaires sont écrits à l'heure du processus (`mysql2`, sans
 * fuseau de connexion), et une base réglée sur un autre fuseau décalerait
 * d'autant l'ouverture des paliers — le rappel 10 h partirait 6 h avant avec
 * une base en UTC, quand le programme d'arbitrage, lui, partirait à 10 h.
 */
const SWEEP_MATCH_SELECT = `SELECT m.id, m.tournament_id, m.bracket, m.round_number, m.start_at,
            m.team1_id, m.team2_id,
            t.name AS tournament_name, t.participant_type, ${swissRoundSql("m", "t")},
            t1.name AS team1_name, t2.name AS team2_name,
            EXISTS (SELECT 1 FROM bg_match_reminders sm WHERE sm.match_id = m.id AND sm.offset_key = ?) AS seen_mark,
            EXISTS (SELECT 1 FROM bg_match_reminders tm WHERE tm.match_id = m.id AND tm.offset_key = ?) AS told_mark
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.status NOT IN (${PLAYED_MATCH_STATUSES.map((status) => `'${status}'`).join(", ")})
        AND t.state <> 'FINISHED'
        AND m.start_at IS NOT NULL
        AND m.start_at > ?`;

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
  // En cas d'échec avant les joueurs, l'observation posée par `setMatchStartAt`
  // est rendue avec les paliers : le balayage annoncera la manche.
  const send: PlannedSend = {
    match,
    offset: null,
    remaining: [],
    announcement,
    claimed: [MATCH_SEEN_KEY],
    now,
    plannedAt: Date.now(),
  };
  try {
    for (const offset of opened) {
      if (!(await claimDatedMark(match, offset.key))) return 0;
      send.claimed?.push(offset.key);
    }
  } catch (error) {
    await releaseClaims(send);
    throw error;
  }
  const openedKeys = new Set(opened.map((offset) => offset.key));
  send.remaining = MATCH_REMINDER_OFFSETS.filter((offset) => !openedKeys.has(offset.key));
  const recipientsByTeam = await recipientsOrRelease([send]);
  return dispatchPlannedSend(send, recipientsByTeam);
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

  const send: PlannedSend = { match, offset: null, remaining: [], clearedStartAt: previousStartAt };
  const recipientsByTeam = await recipientsOrRelease([send]);
  return dispatchPlannedSend(send, recipientsByTeam);
}

/**
 * Ce que l'avis d'une engagée retirée dit de sa manche, relevé dans la
 * transaction du changement (`./departed-notices`) : la manche peut avoir été
 * supprimée depuis (ronde réappariée, retour en arrière).
 */
export type WithdrawnMatch = {
  tournamentId: number;
  tournamentName: string;
  /** Phase de la manche (`0` hors multi-phases). */
  phaseId: number;
  /** Tournoi individuel : aucun nom dans l'avis (« Ton match »). */
  solo: boolean;
  /** Horaires posés par l'arbitrage : un horaire retiré sera remplacé. */
  refereeScheduling: boolean;
  bracket: string;
  roundNumber: number;
  swiss: boolean;
};

/**
 * Une engagée retirée d'une manche par un changement du tournoi, avec
 * l'horaire qu'elle avait reçu et l'adversaire de cet horaire
 * (`./departed-notices`).
 */
export type DepartedEntrant = {
  matchId: number;
  teamId: number;
  /** L'adversaire de l'horaire reçu (`null` : place vide, « TBD »). */
  opponentId: number | null;
  heldStartAt: string | Date;
  match: WithdrawnMatch;
};

type CurrentMatchRow = PosterRow & {
  tournament_id: number;
  phase_id: number;
  bracket: string;
  round_number: number;
  start_at: Date | string | null;
};

type TeamNameRow = RowDataPacket & { id: number; name: string };

/** Ce que l'avis dira à une engagée sortie, une fois l'état d'arrivée relu. */
type WithdrawnOutcome =
  /**
   * Rien à dire : revenue sur sa manche (seconde correction), reposée sur une
   * rencontre au même horaire, ou sur une rencontre sans horaire d'un tournoi
   * qui ne les pose pas (le lancement préviendra, comme après un retrait).
   */
  | { kind: "silent" }
  /**
   * Reposée contre le même adversaire dans la même manche (ronde réappariée,
   * plateau refait) : seul l'horaire est retiré, un nouveau lui sera annoncé.
   * `linkMatchId` : la nouvelle rencontre.
   */
  | { kind: "cleared"; linkMatchId: number }
  /** Elle ne joue plus ce match. `linkMatchId` : `null` si la manche a disparu. */
  | { kind: "withdrawn"; linkMatchId: number | null };

/**
 * Prévient les joueurs des engagées **retirées** d'une manche dont ils
 * tenaient l'horaire, une fois le changement commité : message privé Discord
 * (français, « Ton match » en tournoi individuel) et push dans la langue de
 * chacun, même étiquette que l'annonce qu'il remplace. Au meilleur effort.
 *
 * L'état d'arrivée décide du message ({@link withdrawnOutcome}) : une engagée
 * reposée contre le même adversaire dans la même manche lit « Horaire du match
 * retiré » (un nouvel horaire lui sera annoncé) ; les autres lisent « Match
 * retiré de ton programme ».
 *
 * Trois lectures pour tous les avis (manches d'avant et d'arrivée, noms des
 * sortantes et de leurs adversaires, destinataires), puis les envois,
 * quelques-uns à la fois.
 *
 * @returns Le nombre de messages déclenchés (un par engagée qui a des destinataires).
 */
export async function announceEntrantsWithdrawn(departures: readonly DepartedEntrant[]): Promise<number> {
  if (departures.length === 0) return 0;
  const db = await getDatabase();
  const matchIds = [...new Set(departures.map((departure) => departure.matchId))];
  const tournamentIds = [...new Set(departures.map((departure) => departure.match.tournamentId))];
  const departedIds = [...new Set(departures.map((departure) => departure.teamId))];
  const teamIds = [
    ...new Set(departures.flatMap((departure) => [departure.teamId, departure.opponentId ?? departure.teamId])),
  ];
  // Trois branches réunies : la clé primaire, puis les rencontres des
  // sortantes par place (index des clés étrangères `team1_id` / `team2_id` —
  // une équipe joue peu de rencontres —, filtrées sur le tournoi). Un `OR`
  // entre la clé et ces index pousserait à balayer la table.
  const columns = "id, tournament_id, phase_id, bracket, round_number, team1_id, team2_id, start_at";
  const inTournaments = `tournament_id IN (${sqlPlaceholders(tournamentIds.length)})`;
  const [currentRows] = await db.query<CurrentMatchRow[]>(
    `SELECT ${columns} FROM bg_matches WHERE id IN (${sqlPlaceholders(matchIds.length)})
     UNION
     SELECT ${columns} FROM bg_matches WHERE ${inTournaments} AND team1_id IN (${sqlPlaceholders(departedIds.length)})
     UNION
     SELECT ${columns} FROM bg_matches WHERE ${inTournaments} AND team2_id IN (${sqlPlaceholders(departedIds.length)})`,
    [...matchIds, ...tournamentIds, ...departedIds, ...tournamentIds, ...departedIds],
  );
  const [nameRows] = await db.query<TeamNameRow[]>(
    `SELECT id, name FROM bg_teams WHERE id IN (${sqlPlaceholders(teamIds.length)})`,
    teamIds,
  );
  const names = new Map(nameRows.map((row) => [Number(row.id), String(row.name)]));
  const sends = departures
    .filter((departure) => names.has(departure.teamId))
    .map((departure) => ({ departure, outcome: withdrawnOutcome(departure, currentRows) }))
    .filter(
      (send): send is { departure: DepartedEntrant; outcome: Extract<WithdrawnOutcome, { linkMatchId: number | null }> } =>
        send.outcome.kind === "cleared" || send.outcome.kind === "withdrawn",
    );
  if (sends.length === 0) return 0;

  const recipientsByTeam = await loadRecipientsByTeam([...new Set(sends.map(({ departure }) => departure.teamId))]);
  let dispatched = 0;
  await inBatches(sends, SWEEP_CONCURRENCY, async ({ departure, outcome }) => {
    const recipients = recipientsByTeam.get(departure.teamId) ?? [];
    if (recipients.length === 0) return;
    const opponentName = (departure.opponentId === null ? undefined : names.get(departure.opponentId)) ?? "TBD";
    // Un avis en échec ne retient pas les autres.
    try {
      await sendWithdrawnNotice(departure, outcome, String(names.get(departure.teamId)), opponentName, recipients);
      dispatched += 1;
    } catch (error) {
      console.error("[notify] avis de match retiré non envoyé", error);
    }
  });
  return dispatched;
}

/**
 * Ce que l'état d'arrivée dit d'une sortie : revenue sur sa manche, reposée
 * contre le même adversaire dans la même manche (même tournoi, phase, partie
 * de plateau et numéro de manche — une ronde réappariée ou un plateau refait
 * crée de nouvelles rencontres), ou retirée.
 */
function withdrawnOutcome(departure: DepartedEntrant, current: readonly CurrentMatchRow[]): WithdrawnOutcome {
  const original = current.find((row) => Number(row.id) === departure.matchId);
  if (original && onPoster(toPoster(original), departure.teamId)) return { kind: "silent" };
  const { match, opponentId, teamId } = departure;
  const repaired =
    opponentId === null
      ? undefined
      : current.find((row) => {
          const poster = toPoster(row);
          return (
            Number(row.id) !== departure.matchId &&
            Number(row.tournament_id) === match.tournamentId &&
            Number(row.phase_id ?? 0) === match.phaseId &&
            String(row.bracket) === match.bracket &&
            Number(row.round_number) === match.roundNumber &&
            onPoster(poster, teamId) &&
            onPoster(poster, opponentId)
          );
        });
  if (repaired) return repairedOutcome(departure, repaired);
  return { kind: "withdrawn", linkMatchId: original ? departure.matchId : null };
}

/**
 * Engagée reposée contre le même adversaire dans la même manche : rien si la
 * nouvelle rencontre tient le même horaire ; sinon l'horaire reçu est retiré
 * — un nouvel horaire suivra (posé par l'arbitrage, ou déjà posé et annoncé
 * par le balayage). Un tournoi sans horaires d'arbitrage dont la rencontre
 * n'en a pas se tait, comme pour un retrait (`schedule-notices.ts`).
 */
function repairedOutcome(departure: DepartedEntrant, repaired: CurrentMatchRow): WithdrawnOutcome {
  if (repaired.start_at === null) {
    return departure.match.refereeScheduling ? { kind: "cleared", linkMatchId: Number(repaired.id) } : { kind: "silent" };
  }
  const same = new Date(repaired.start_at).getTime() === new Date(departure.heldStartAt).getTime();
  return same ? { kind: "silent" } : { kind: "cleared", linkMatchId: Number(repaired.id) };
}

/** L'avis d'une engagée sortie, à ses joueurs. */
async function sendWithdrawnNotice(
  departure: DepartedEntrant,
  outcome: { kind: "cleared" | "withdrawn"; linkMatchId: number | null },
  teamName: string,
  opponentName: string,
  recipients: NotificationRecipient[],
): Promise<void> {
  const { match } = departure;
  const context = {
    tournamentName: match.tournamentName,
    tournamentUrl: tournamentPageUrl(match.tournamentId),
    matchDmSettingsUrl: siteUrl(MATCH_DM_SETTINGS_PATH),
    teamName,
    opponentName,
    roundLabel: matchRoundLabel(match.bracket, match.roundNumber, match.swiss),
    roundLabelEn: pushRoundLabel(match.bracket, match.roundNumber, "en", match.swiss),
    startAt: departure.heldStartAt,
    solo: match.solo,
  };
  // L'étiquette reste celle de l'ancienne rencontre (l'avis remplace son
  // annonce sur l'appareil) ; le lien mène à la rencontre qui existe, ou à la
  // page du tournoi.
  const pushSide = {
    tournamentId: match.tournamentId,
    tournamentName: match.tournamentName,
    matchId: departure.matchId,
    linkMatchId: outcome.linkMatchId,
    teamName,
    opponentName,
    bracket: match.bracket,
    roundNumber: match.roundNumber,
    swiss: match.swiss,
    startAt: departure.heldStartAt,
    solo: match.solo,
  };
  const cleared = outcome.kind === "cleared";
  await notifyUsers(recipients, {
    topic: "MATCH_REMINDER",
    discord: cleared
      ? { message: (locale) => buildMatchScheduleClearedNotice(context, locale), context: "match-schedule-cleared" }
      : { message: (locale) => buildMatchWithdrawnNotice(context, locale), context: "match-withdrawn" },
    push: (locale) => (cleared ? matchScheduleClearedPush(pushSide, locale) : matchWithdrawnPush(pushSide, locale)),
  });
}

/**
 * Destinataires des envois retenus, en une lecture. Si elle échoue, les marques
 * réservées pour ces envois sont rendues — sans quoi tous seraient consommés
 * sans message, et jamais retentés.
 */
async function recipientsOrRelease(sends: PlannedSend[]): Promise<Map<number, NotificationRecipient[]>> {
  const teamIds = [...new Set(sends.flatMap(({ match }) => [Number(match.team1_id), Number(match.team2_id)]))];
  try {
    return await loadRecipientsByTeam(teamIds);
  } catch (error) {
    await Promise.all(sends.map(releaseClaims));
    throw error;
  }
}

/** L'instant `seconds` secondes après `now`. */
function inSeconds(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
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
  // Une manche dont le dernier palier est déjà pris n'a plus rien à recevoir
  // de ce cycle : elle n'est plus relue à chaque passage (clé unique).
  // Une manche déjà observée n'a rien à recevoir avant l'ouverture de son
  // premier palier : au-delà, seule une manche jamais vue (à annoncer) est lue.
  // Une manche dont le palier ouvert est déjà pris attend l'ouverture du
  // suivant sans être relue (`WAITING_OFFSETS`).
  const waiting = WAITING_OFFSETS.map(
    () => `
        AND NOT EXISTS (SELECT 1 FROM bg_match_reminders sent
                         WHERE sent.match_id = m.id AND sent.offset_key = ?
                           AND m.start_at > ?)`,
  ).join("");
  const [matches] = await db.query<SweepMatchRow[]>(
    `${SWEEP_MATCH_SELECT}
        AND m.start_at <= ?
        AND NOT EXISTS (SELECT 1 FROM bg_match_reminders done
                         WHERE done.match_id = m.id AND done.offset_key = ?)${waiting}
     HAVING m.start_at <= ? OR seen_mark = 0`,
    [
      MATCH_SEEN_KEY,
      MATCH_TOLD_KEY,
      now,
      inSeconds(now, Math.round(MATCH_REMINDER_LOOKAHEAD_MS / 1000)),
      LAST_REMINDER_KEY,
      ...WAITING_OFFSETS.flatMap(({ key, nextOpensSeconds }) => [key, inSeconds(now, nextOpensSeconds)]),
      inSeconds(now, FIRST_REMINDER_LEAD_SECONDS),
    ],
  );
  if (matches.length === 0) return 0;

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
      planned.push(...(await planMatchSends(match, now, sentKeysOf(match))));
    } catch (error) {
      console.error("[match-reminders] réservation de rappel en échec", error);
    }
  });
  if (planned.length === 0) return 0;

  const recipientsByTeam = await recipientsOrRelease(planned);

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
  startRefereeDigest(now);
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
  pendingDigest = null;
  lastDigestAt = 0;
}

/** Programme d'arbitrage en cours, à attendre. Réservé aux tests. */
export function pendingRefereeDigest(): Promise<void> | null {
  return pendingDigest;
}
