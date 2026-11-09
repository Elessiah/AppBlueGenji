/**
 * Annonce d'un **nouveau match** (`NEW_MATCH`, `docs/features/NEW_MATCH_NOTICE.md`) :
 * dès que les deux engagées d'un match sont connues — une manche s'est jouée,
 * la suivante arrive —, tous les membres des deux équipes (le joueur d'une
 * entrée solo) apprennent qui ils affrontent, l'horaire s'il est posé et le
 * lien de la page du match : push du sujet `NEW_MATCH` et message privé
 * Discord (interrupteur des messages privés de match respecté).
 *
 * **Pourquoi un balayage.** Les matchs reçoivent leurs engagées dans tous les
 * moteurs (avancée d'un tableau simple ou double, ronde suisse, survie,
 * multi-phases, BG Survie, retour arrière, tableau reconstruit), dans des
 * transactions qui tiennent le verrou du tournoi. Le balayage relit après coup,
 * **hors de tout verrou et après le commit**, ce qui est devenu jouable : aucun
 * moteur n'a à connaître la notification, et aucun n'est oublié.
 *
 * **Une fois par match.** La réservation (`bg_new_match_notices`) est posée en
 * une instruction (`INSERT IGNORE … SELECT`, `affectedRows`) qui relit le
 * match : la place du match (tournoi, phase, tableau, manche, numéro) et son
 * affiche (les deux engagées, sans ordre). Un match réapparié avec la même
 * affiche, un match effacé puis recréé à la même place avec les mêmes
 * engagées, deux balayages concurrents : un seul envoi. Une autre affiche à la
 * même place (retour arrière puis autre vainqueur) est un autre match, annoncé.
 *
 * **Toutes les manches**, première comprise (décision du 2026-11-09). Seuls
 * les matchs déjà appariés à la mise en service (`installNewMatchNotices`)
 * sont marqués `skipped`.
 *
 * **Horaire déjà posé** : l'annonce le porte, et les marques des rappels sont
 * posées d'abord (`coverMatchSchedule`) — pas de « Match programmé » en double
 * ; le balayage des rappels attend l'annonce (`newMatchPendingSql`).
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import {
  loadEntrantPlayerIds,
  loadNotificationRecipients,
  notifyUsers,
  type NotificationRecipient,
} from "@/lib/server/notify";
import { toIso } from "@/lib/server/serialization";
import { siteUrl } from "@/lib/server/site-url";
import { throttledSweep } from "@/lib/server/throttled-sweep";
import { inBatches } from "@/lib/shared/in-batches";
import {
  CHECK_IN_REMINDER_KEY,
  MATCH_DM_SETTINGS_PATH,
  MATCH_SEEN_KEY,
  MATCH_TOLD_KEY,
  openedMatchReminders,
} from "@/lib/shared/discord-notifications";
import { matchPageHref } from "@/lib/shared/match-anchor";
import { newMatchPush, type NewMatchSide } from "@/lib/shared/push-messages";
import { formatNewMatchDm } from "./new-match-dm";
import { ANNOUNCEABLE_SQL, MARKED_SQL, PAIRING_SQL } from "./new-match-sql";
import { releaseDatedMarks } from "./reminder-marks";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

/** Étranglement du balayage, comme le check-in et les départs de match. */
const NEW_MATCH_THROTTLE_MS = 10_000;
/** Matchs annoncés au plus par passage ; le reste attend le suivant. */
export const NEW_MATCH_BATCH = 50;
/** Matchs annoncés en parallèle, comme le balayage des rappels. */
const NEW_MATCH_CONCURRENCY = 4;

export type NewMatchCandidateRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  bracket: string;
  round_number: number;
  team1_id: number;
  team2_id: number;
  start_at: Date | string | null;
  tournament_name: string;
  participant_type: string;
  swiss_round: number;
  team1_name: string;
  team2_name: string;
  team1_ghost: number;
  team2_ghost: number;
};

/** Clé `bg_settings` : instant de mise en service des annonces. */
export const NEW_MATCH_SINCE_KEY = "new_match_notices_since";

let installed = false;

type PlaceRow = RowDataPacket & {
  tournament_id: number;
  phase_id: number;
  bracket: string;
  round_number: number;
  match_number: number;
  pairing: string;
};

const PLACE_SELECT = `SELECT m.tournament_id, m.phase_id, m.bracket, m.round_number, m.match_number, ${PAIRING_SQL} AS pairing`;

/** Lignes posées par instruction à la mise en service. */
const INSTALL_CHUNK = 200;

/**
 * Mise en service, **une seule fois** par base : les matchs déjà appariés des
 * tournois en cours à cet instant (d'avant le déploiement) sont marqués
 * `skipped`, puis la clé est posée (marques d'abord : une clé visible implique
 * ses marques). Ensuite, tout match apparié est annoncé, première manche
 * comprise. Lecture simple puis insertion de valeurs : un `INSERT … SELECT`
 * poserait des verrous partagés sur les matchs et tournois en cours, face au
 * moteur qui tient le verrou du tournoi.
 */
export async function installNewMatchNotices(db: Pool): Promise<void> {
  if (installed) return;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT 1 FROM bg_settings WHERE setting_key = ?`, [
    NEW_MATCH_SINCE_KEY,
  ]);
  if (rows.length === 0) {
    const [paired] = await db.query<PlaceRow[]>(
      `${PLACE_SELECT}
         FROM bg_matches m
         JOIN bg_tournaments t ON t.id = m.tournament_id
        WHERE t.state = 'RUNNING' AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL`,
    );
    for (let start = 0; start < paired.length; start += INSTALL_CHUNK) {
      const chunk = paired.slice(start, start + INSTALL_CHUNK);
      await db.query(
        `INSERT IGNORE INTO bg_new_match_notices
           (tournament_id, phase_id, bracket, round_number, match_number, pairing, skipped)
         VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, 1)").join(", ")}`,
        chunk.flatMap((place) => [
          place.tournament_id,
          place.phase_id,
          place.bracket,
          place.round_number,
          place.match_number,
          place.pairing,
        ]),
      );
    }
    await db.execute(
      `INSERT IGNORE INTO bg_settings (setting_key, setting_value) VALUES (?, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s'))`,
      [NEW_MATCH_SINCE_KEY],
    );
  }
  installed = true;
}

/**
 * L'horaire d'un match annoncé avec sa date : les marques du balayage des
 * rappels sont posées **avant** la réservation, comme si « Match programmé »
 * était parti — observation, horaire reçu, paliers déjà ouverts. L'annonce
 * porte l'horaire ; « Match programmé » ne part plus que pour une
 * (re)programmation ultérieure. Une marque déjà prise (concurrence) est laissée.
 * Le palier du check-in (10 h) n'est **jamais** pris ici : l'annonce ne porte
 * pas le check-in, le rappel de 10 h le portera.
 *
 * Insertion de valeurs, sans relire le match (un `INSERT … SELECT` le
 * verrouillerait en partage face au moteur) : c'est la réservation qui suit qui
 * relit le match, et ses marques sont rendues si elle échoue.
 *
 * @returns les marques prises ici, à rendre si la réservation échoue.
 */
export async function coverMatchSchedule(
  db: Pool,
  row: NewMatchCandidateRow,
  now: Date = new Date(),
): Promise<string[]> {
  if (row.start_at === null) return [];
  const keys = [
    MATCH_SEEN_KEY,
    MATCH_TOLD_KEY,
    ...openedMatchReminders(row.start_at, now)
      .map((offset) => offset.key)
      .filter((key) => key !== CHECK_IN_REMINDER_KEY),
  ];
  const claimed: string[] = [];
  for (const key of keys) {
    const [result] = await db.execute(
      `INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at) VALUES (?, ?, ?)`,
      [Number(row.id), key, row.start_at],
    );
    if ((result as { affectedRows?: number }).affectedRows === 1) claimed.push(key);
  }
  return claimed;
}

async function loadCandidates(db: Pool): Promise<NewMatchCandidateRow[]> {
  const [rows] = await db.query<NewMatchCandidateRow[]>(
    `SELECT m.id, m.tournament_id, m.bracket, m.round_number, m.team1_id, m.team2_id, m.start_at,
            t.name AS tournament_name, t.participant_type, ${swissRoundSql("m", "t")},
            t1.name AS team1_name, t2.name AS team2_name,
            t1.is_ghost AS team1_ghost, t2.is_ghost AS team2_ghost
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE ${ANNOUNCEABLE_SQL} AND NOT ${MARKED_SQL}
      ORDER BY m.id
      LIMIT ${NEW_MATCH_BATCH}`,
  );
  return rows;
}

/**
 * Le match est-il toujours celui qui a été lu — mêmes engagées (existantes,
 * fantômes ou non comme lues), même horaire — et reste-t-il à annoncer ?
 * Lecture simple, non verrouillante.
 *
 * @returns sa place, ou `null` s'il a changé.
 */
async function currentPlace(db: Pool, row: NewMatchCandidateRow): Promise<PlaceRow | null> {
  const [places] = await db.execute<PlaceRow[]>(
    `${PLACE_SELECT}
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       JOIN bg_teams t1 ON t1.id = m.team1_id
       JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.id = ? AND m.team1_id = ? AND m.team2_id = ? AND m.start_at <=> ?
        AND t1.is_ghost = ? AND t2.is_ghost = ? AND ${ANNOUNCEABLE_SQL}`,
    [
      Number(row.id),
      Number(row.team1_id),
      Number(row.team2_id),
      row.start_at,
      Number(row.team1_ghost),
      Number(row.team2_ghost),
    ],
  );
  return places[0] ?? null;
}

function placeParams(place: PlaceRow): Array<string | number> {
  return [place.tournament_id, place.phase_id, place.bracket, place.round_number, place.match_number, place.pairing];
}

const PLACE_WHERE = `tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ? AND match_number = ? AND pairing = ?`;

/** Issue d'une réservation : prise, match changé depuis la lecture, ou déjà prise ailleurs. */
export type NewMatchClaim = { kind: "claimed"; place: PlaceRow } | { kind: "changed" } | { kind: "taken" };

/**
 * Réserve l'annonce **si le match est toujours celui qui a été lu**, puis le
 * relit : un réappariement, un score, un horaire posé ou une équipe supprimée
 * entre la lecture et la réservation — ou entre la relecture et l'insertion —
 * rend la réservation (`changed`), et le passage suivant annonce le match tel
 * qu'il est, à ses équipes du moment. Lectures simples (non verrouillantes) et
 * insertion de valeurs : un `INSERT … SELECT` verrouillerait en partage le
 * match et le tournoi, face au moteur qui tient le verrou du tournoi. La clé
 * primaire tranche seule entre deux balayages concurrents (`taken`). L'horaire
 * annoncé est gardé (`start_at`) : « Match programmé » ne le redit pas.
 */
export async function claimNewMatchNotice(db: Pool, row: NewMatchCandidateRow): Promise<NewMatchClaim> {
  const place = await currentPlace(db, row);
  if (!place) return { kind: "changed" };
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_new_match_notices
       (tournament_id, phase_id, bracket, round_number, match_number, pairing, skipped, start_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [...placeParams(place), row.start_at],
  );
  if ((result as { affectedRows?: number }).affectedRows !== 1) return { kind: "taken" };
  if (await currentPlace(db, row)) return { kind: "claimed", place };
  await dropReservation(db, place);
  return { kind: "changed" };
}

async function dropReservation(db: Pool, place: PlaceRow): Promise<void> {
  await db.execute(`DELETE FROM bg_new_match_notices WHERE ${PLACE_WHERE} AND skipped = 0`, placeParams(place));
}

/** Le match vu d'une engagée. */
export function newMatchSide(row: NewMatchCandidateRow, side: 1 | 2): NewMatchSide {
  return {
    tournamentId: Number(row.tournament_id),
    tournamentName: String(row.tournament_name),
    matchId: Number(row.id),
    teamName: String(side === 1 ? row.team1_name : row.team2_name),
    opponentName: String(side === 1 ? row.team2_name : row.team1_name),
    solo: row.participant_type === "SOLO",
    bracket: String(row.bracket),
    roundNumber: Number(row.round_number),
    swiss: isSwissRound(row),
    startAt: row.start_at === null ? null : toIso(row.start_at),
  };
}

/** Une engagée : son échec ne retient pas l'autre. */
async function announceSide(
  row: NewMatchCandidateRow,
  side: 1 | 2,
  recipients: NotificationRecipient[],
): Promise<boolean> {
  const url = siteUrl(matchPageHref(Number(row.tournament_id), Number(row.id)));
  const settingsUrl = siteUrl(MATCH_DM_SETTINGS_PATH);
  const match = newMatchSide(row, side);
  try {
    const report = await notifyUsers(recipients, {
      topic: "NEW_MATCH",
      push: (locale) => newMatchPush(match, locale),
      discord: { message: (locale) => formatNewMatchDm(match, url, locale, settingsUrl), context: "new-match" },
    });
    if (report.discordUnreachedUserIds.length > 0) {
      console.error(
        `[new-match] bot injoignable, ${report.discordUnreachedUserIds.length} message(s) privé(s) perdu(s) (match ${row.id})`,
      );
    }
    return true;
  } catch (error) {
    // Réservation gardée : une annonce manquée ne se répète pas en boucle.
    console.error(`[new-match] annonce en échec (match ${row.id}, engagée ${side})`, failureReason(error));
    return false;
  }
}

async function announce(
  row: NewMatchCandidateRow,
  playersByTeam: Map<number, number[]>,
  recipientsById: Map<number, NotificationRecipient>,
): Promise<number> {
  // Un compte qui serait des deux côtés n'est prévenu qu'une fois, du premier.
  const told = new Set<number>();
  let sides = 0;
  for (const side of [1, 2] as const) {
    // Une fantôme n'a personne à prévenir (`GHOST_TEAMS.md`).
    if (Number(side === 1 ? row.team1_ghost : row.team2_ghost) === 1) continue;
    const teamId = Number(side === 1 ? row.team1_id : row.team2_id);
    const recipients = (playersByTeam.get(teamId) ?? [])
      .filter((userId) => !told.has(userId))
      .flatMap((userId) => recipientsById.get(userId) ?? []);
    if (recipients.length === 0) continue;
    for (const recipient of recipients) told.add(recipient.userId);
    if (await announceSide(row, side, recipients)) sides += 1;
  }
  return sides;
}

/** Échecs d'affilée d'un match avant qu'on renonce à l'annoncer. */
export const NEW_MATCH_MAX_FAILURES = 3;
const failures = new Map<number, number>();

/**
 * Un match qui échoue d'affilée ({@link NEW_MATCH_MAX_FAILURES} fois) est
 * marqué `skipped` : il ne retient plus ses rappels, qui donneront l'horaire.
 */
async function noteFailure(db: Pool, row: NewMatchCandidateRow, error: unknown): Promise<void> {
  const count = (failures.get(Number(row.id)) ?? 0) + 1;
  failures.set(Number(row.id), count);
  console.error(`[new-match] annonce en échec (match ${row.id}, essai ${count})`, failureReason(error));
  if (count < NEW_MATCH_MAX_FAILURES) return;
  failures.delete(Number(row.id));
  try {
    const [places] = await db.execute<PlaceRow[]>(`${PLACE_SELECT} FROM bg_matches m WHERE m.id = ?`, [Number(row.id)]);
    const place = places[0];
    if (!place) return;
    await db.execute(
      `INSERT IGNORE INTO bg_new_match_notices
         (tournament_id, phase_id, bracket, round_number, match_number, pairing, skipped)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      placeParams(place),
    );
  } catch (giveUpError) {
    console.error(`[new-match] abandon non marqué (match ${row.id})`, failureReason(giveUpError));
  }
}

/**
 * Un match : marques des rappels, réservation (relue après coup), puis
 * destinataires lus **après** la réservation, au plus près de l'envoi — un
 * membre parti entre-temps n'est plus prévenu. Comptes supprimés écartés par
 * `loadNotificationRecipients` ; interrupteur des messages privés de match lu.
 * Une panne avant l'envoi rend la réservation et les marques prises (le passage
 * suivant réessaie) ; toute erreur reste à ce match.
 */
async function sweepOne(db: Pool, row: NewMatchCandidateRow): Promise<number> {
  let covered: string[] = [];
  let reserved: PlaceRow | null = null;
  try {
    covered = await coverMatchSchedule(db, row);
    const claim = await claimNewMatchNotice(db, row);
    // Prise ailleurs : ce balayage-là s'en charge, avec les marques qu'il tient.
    if (claim.kind === "taken") return 0;
    if (claim.kind === "changed") {
      if (row.start_at !== null) await releaseDatedMarks(Number(row.id), covered, row.start_at);
      return 0;
    }
    reserved = claim.place;
    const playersByTeam = await loadEntrantPlayerIds([Number(row.team1_id), Number(row.team2_id)]);
    const recipients = await loadNotificationRecipients([...playersByTeam.values()].flat(), "certified", {
      matchDm: true,
    });
    const recipientsById = new Map(recipients.map((recipient) => [recipient.userId, recipient]));
    failures.delete(Number(row.id));
    return await announce(row, playersByTeam, recipientsById);
  } catch (error) {
    try {
      if (reserved) await dropReservation(db, reserved);
      if (row.start_at !== null) await releaseDatedMarks(Number(row.id), covered, row.start_at);
    } catch {
      // Rendu au mieux : le journal ci-dessous dit l'échec.
    }
    await noteFailure(db, row, error);
    return 0;
  }
}

/** Clé `bg_settings` : dernier passage vivant du balayage (`newMatchPendingSql`). */
export const NEW_MATCH_HEARTBEAT_KEY = "new_match_sweep_at";
/** Le pouls n'est réécrit qu'une fois par minute au plus. */
const HEARTBEAT_EVERY_MS = 60_000;
let lastHeartbeatAt = 0;
let lastRunOk = true;

/**
 * Pouls du balayage, posé au **début** d'un passage si le précédent a abouti :
 * tant qu'il est frais, le balayage des rappels attend l'annonce d'un match
 * apparié ; un balayage en panne le laisse vieillir, et les rappels reprennent.
 */
async function beat(db: Pool, previousRunOk: boolean): Promise<void> {
  if (!previousRunOk || Date.now() - lastHeartbeatAt < HEARTBEAT_EVERY_MS) return;
  await db.execute(
    `INSERT INTO bg_settings (setting_key, setting_value) VALUES (?, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s'))
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [NEW_MATCH_HEARTBEAT_KEY],
  );
  lastHeartbeatAt = Date.now();
}

async function sweepNewMatches(): Promise<number> {
  const db = await getDatabase();
  const previousRunOk = lastRunOk;
  lastRunOk = false;
  await installNewMatchNotices(db);
  await beat(db, previousRunOk);
  const candidates = await loadCandidates(db);
  let announced = 0;
  await inBatches(candidates, NEW_MATCH_CONCURRENCY, async (row) => {
    announced += await sweepOne(db, row);
  });
  lastRunOk = true;
  // Lot plein : il en reste peut-être, le passage suivant les prendra.
  if (candidates.length === NEW_MATCH_BATCH) sweeps.schedule(NEW_MATCH_THROTTLE_MS);
  return announced;
}

const sweeps = throttledSweep({
  throttleMs: NEW_MATCH_THROTTLE_MS,
  sweep: sweepNewMatches,
  onError: (error) => {
    if (!isMissingTableError(error)) console.error("[new-match] balayage en échec", failureReason(error));
  },
});

/**
 * Annonce les nouveaux matchs. Jamais bloquant, jamais une exception :
 * l'appelant est une écriture déjà faite ou une lecture de page.
 *
 * @returns le nombre d'engagées prévenues.
 */
export async function dispatchNewMatchNotices(): Promise<number> {
  return sweeps.run();
}

/** Remet l'étranglement à zéro. Réservé aux tests. */
export function resetNewMatchNoticeThrottle(): void {
  sweeps.reset();
  installed = false;
  failures.clear();
  lastHeartbeatAt = 0;
  lastRunOk = true;
}
