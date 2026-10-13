/**
 * Ce que produit un horaire de match posé ou changé par l'arbitrage
 * (`setMatchStartAt`) : l'annonce aux joueurs, la notification aux arbitres et
 * la ligne du journal Discord.
 *
 * - **Joueurs** des deux engagées : message privé Discord et push
 *   `MATCH_REMINDER` (« Match programmé » / « Match reprogrammé »), par
 *   `announceMatchSchedule`. La marque d'observation, qui évite le doublon
 *   avec le balayage des rappels, est posée par `setMatchStartAt` dans la
 *   transaction de la date.
 * - **Arbitres** : push `MATCH_SCHEDULED` aux comptes qui portent la
 *   permission `tournaments`, **sauf l'auteur** du geste.
 * - **Journal** : une ligne au canal de logs, auteur anonymisé (« le staff »)
 *   et nommé dans pm2 (`publishStaffAction`). Aucun pseudo de joueur : les
 *   engagées passent par `entrantLabel`.
 *
 * Une date **effacée** est journalisée et, si les joueurs avaient reçu
 * l'horaire et qu'il était encore devant, leur est annoncée (« Horaire du
 * match retiré ») ; les arbitres aussi, si l'horaire était encore devant (leur
 * avis « programmé » est remplacé). Rien ne part pour une date
 * inchangée ; une date déjà passée (correction d'archive) ou posée sur un
 * match déjà joué n'est que journalisée. Tout est au
 * meilleur effort et après le commit : l'horaire est enregistré, une panne de
 * notification n'y change rien.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { toIso } from "@/lib/server/serialization";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { notifyStaff } from "@/lib/server/notify";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { formatMatchScheduleClearedLog, formatMatchScheduledLog } from "@/lib/shared/bot-logs";
import { MATCH_SEEN_KEY, type ScheduleAnnouncement } from "@/lib/shared/discord-notifications";
import type { LogEntrant, StaffActor } from "@/lib/shared/log-privacy";
import { toParticipantType } from "@/lib/shared/participants";
import { matchScheduleClearedStaffPush, matchScheduledStaffPush } from "@/lib/shared/push-messages";
import { announceMatchSchedule, announceMatchScheduleCleared, type MatchNotice } from "./match-reminders";
import { isPlayedMatchStatus } from "@/lib/shared/match-schedule";
import {
  forgetStaffPush,
  HELD_TIME_GRACE_MS,
  markStaffPushed,
  releaseDatedMarks,
  releaseStaffPush,
} from "./reminder-marks";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

type ScheduledMatchInfoRow = RowDataPacket & MatchNotice;

export type MatchScheduleChange = {
  matchId: number;
  /** Nouvel horaire (ISO), `null` s'il a été effacé. */
  startAt: string | null;
  /** Horaire d'avant (ISO), `null` si la manche n'en avait pas. */
  previousStartAt: string | null;
  /**
   * Les joueurs avaient déjà **reçu** un horaire (annonce ou rappel), même si
   * la date a été effacée entre-temps.
   */
  alreadyAnnounced: boolean;
  /**
   * L'horaire que les joueurs ont reçu en dernier (`null` : aucun — un retrait
   * leur a été remis depuis ; les marques héritées de l'ancien code portent
   * l'horaire de la manche, recopié au démarrage).
   */
  toldStartAt: string | null;
  /**
   * L'horaire poussé aux arbitres en dernier (`STAFF`, `null` : aucun) — seul
   * celui-là voit son retrait poussé ({@link refereesWerePushed}).
   */
  staffStartAt: string | null;
  /**
   * Le tournoi est planifié par l'arbitrage. Sans l'option, un match sans
   * horaire part en lancement : un horaire retiré ne sera pas remplacé, et
   * l'avis « le nouvel horaire te sera annoncé » mentirait (le départ du match,
   * `MATCH_START`, prévient les joueurs).
   */
  refereeScheduling: boolean;
  /**
   * Les engagées de la manche **sous le verrou** de l'écriture : celles dont
   * les marques de rappel viennent d'être remises à jour. Relue ensuite, la
   * manche peut en avoir changé (score propagé, correction) — ses avis aux
   * joueurs reviennent alors au balayage.
   */
  entrantIds: [number | null, number | null];
  /** Auteur du geste, `null` hors d'une requête du staff. */
  actor: StaffActor | null;
};


/**
 * L'horaire que les joueurs tiennent : le dernier reçu (`toldStartAt`) — et
 * seulement s'il vaut encore, devant ou passé de peu (un match en retard). Un
 * horaire passé depuis longtemps ne se cite ni ne se retire ; après un retrait
 * remis (`null`), ils n'en tiennent aucun : rien à citer, rien à retirer.
 */
export function heldStartAt(change: MatchScheduleChange, now: Date = new Date()): string | null {
  if (!change.alreadyAnnounced) return null;
  const held = change.toldStartAt;
  if (held === null || held === change.startAt) return null;
  const time = new Date(held).getTime();
  return time > now.getTime() - HELD_TIME_GRACE_MS ? held : null;
}

/**
 * Ce que l'annonce dit aux **joueurs** : « reprogrammé » s'ils avaient reçu un
 * horaire — une date posée quand une place était encore vide, jamais annoncée,
 * ne compte pas —, avec l'horaire qu'ils tenaient (« au lieu du … »), pas une
 * date intermédiaire qui ne leur a jamais été envoyée.
 */
export function playerAnnouncement(change: MatchScheduleChange, now: Date = new Date()): ScheduleAnnouncement {
  if (!change.alreadyAnnounced) return { rescheduled: false, previousStartAt: null };
  return { rescheduled: true, previousStartAt: heldStartAt(change, now) };
}

/**
 * Ce que l'annonce dit aux **arbitres** et au journal : la date précédente,
 * qu'ils voyaient sur le plateau, ou une annonce faite d'une date effacée depuis.
 */
export function staffAnnouncement(change: MatchScheduleChange): ScheduleAnnouncement {
  return {
    rescheduled: change.previousStartAt !== null || change.alreadyAnnounced,
    previousStartAt: change.previousStartAt,
  };
}

/** L'horaire mérite-t-il d'être annoncé ? Posé, changé, et encore devant. */
export function isAnnounceableSchedule(change: MatchScheduleChange, now: Date = new Date()): boolean {
  if (change.startAt === null || change.startAt === change.previousStartAt) return false;
  const start = new Date(change.startAt).getTime();
  return Number.isFinite(start) && start > now.getTime();
}

/**
 * La manche, lue **une fois** pour tous les avis d'un changement : journal,
 * arbitres et joueurs (`announceMatchSchedule` la reçoit au lieu de la relire).
 */
async function loadMatchInfo(matchId: number): Promise<ScheduledMatchInfoRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<ScheduledMatchInfoRow[]>(
    // Un tournoi clos ne se joue plus : ses manches comptent pour jouées
    // (journal seul, ni annonce ni push), comme une manche au score saisi.
    `SELECT m.id, m.tournament_id, m.bracket, m.round_number,
            IF(t.state = 'FINISHED', 'COMPLETED', m.status) AS status,
            m.start_at, m.team1_id, m.team2_id,
            t.name AS tournament_name, t.participant_type, ${swissRoundSql("m", "t")},
            t1.name AS team1_name, t2.name AS team2_name
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.id = ? LIMIT 1`,
    [matchId],
  );
  return rows[0] ?? null;
}

/**
 * La manche relue a les engagées de l'écriture : les marques posées ou lues
 * sous verrou (`SEEN`, `TOLD`) sont bien les leurs. Sinon (place remplie ou
 * engagée remplacée entre-temps), annoncer doublerait l'annonce du balayage,
 * ou préviendrait d'un retrait des joueurs qui n'avaient rien reçu.
 */
function sameEntrants(row: ScheduledMatchInfoRow, change: MatchScheduleChange): boolean {
  const ids = [row.team1_id, row.team2_id].map((id) => (id === null ? null : Number(id)));
  return ids[0] === change.entrantIds[0] && ids[1] === change.entrantIds[1];
}

/**
 * La manche relue porte encore l'horaire de ce changement. Sinon, un
 * changement plus récent l'a remplacé, et c'est à lui d'avertir joueurs et
 * arbitres : annoncer ici l'horaire relu doublerait son annonce.
 */
function stillCurrent(row: ScheduledMatchInfoRow, change: MatchScheduleChange): boolean {
  return toIso(row.start_at) === change.startAt;
}

/** Les joueurs de la manche relue sont à prévenir par ce changement-ci. */
function ownsPlayerNotice(row: ScheduledMatchInfoRow, change: MatchScheduleChange): boolean {
  return sameEntrants(row, change) && stillCurrent(row, change);
}


/** Les deux engagées d'une manche pour le journal (`null` : place encore vide). */
function logEntrants(row: ScheduledMatchInfoRow): { team1: LogEntrant | null; team2: LogEntrant | null } {
  const participantType = toParticipantType(row.participant_type);
  const entrant = (name: string | null): LogEntrant | null => (name === null ? null : { name, participantType });
  return { team1: entrant(row.team1_name), team2: entrant(row.team2_name) };
}

/**
 * Écrit la ligne du journal et, pour une date à annoncer (`push`), prévient les
 * arbitres.
 */
async function notifyReferees(
  row: ScheduledMatchInfoRow,
  change: MatchScheduleChange & { startAt: string },
  push: boolean,
): Promise<number> {
  const participantType = toParticipantType(row.participant_type);
  const { team1, team2 } = logEntrants(row);
  const announcement = staffAnnouncement(change);
  const tournament = { id: Number(row.tournament_id), name: String(row.tournament_name) };

  const line = formatMatchScheduledLog({
    tournament,
    matchId: change.matchId,
    bracket: String(row.bracket),
    roundNumber: Number(row.round_number),
    swiss: isSwissRound(row),
    team1,
    team2,
    startAt: change.startAt,
    previousStartAt: change.previousStartAt,
    rescheduled: announcement.rescheduled,
  });
  if (change.actor) publishStaffAction(line, change.actor);
  // Un match joué ne se rejouera pas : la date est une correction d'archive,
  // tracée au journal mais annoncée à personne (les joueurs non plus).
  if (!push || isPlayedMatchStatus(row.status)) return 0;

  // Réservée avant l'envoi : un retrait qui suivrait de près doit la trouver.
  await markStaffPushed(change.matchId, change.startAt);
  // L'auteur ne se prévient pas lui-même. Un arbitre qui joue ce match reçoit
  // les deux versions (étiquettes distinctes) : un doublon plutôt qu'une
  // annonce qui en remplace une autre, ou aucune.
  const { pushed } = await notifyStaff({
    topic: "MATCH_SCHEDULED",
    excludeUserIds: change.actor ? [change.actor.id] : [],
    push: (locale) =>
      matchScheduledStaffPush(
        {
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          matchId: change.matchId,
          team1Name: row.team1_name,
          team2Name: row.team2_name,
          solo: participantType === "SOLO",
          bracket: String(row.bracket),
          roundNumber: Number(row.round_number),
          swiss: isSwissRound(row),
          startAt: change.startAt,
        },
        announcement,
        locale,
      ),
  });
  // Aucun appareil atteint : rien à retirer chez eux plus tard.
  if (pushed === 0) await releaseStaffPush(change.matchId, change.startAt);
  return pushed;
}

/**
 * L'horaire effacé à annoncer aux joueurs, ou `null` s'il n'y a rien à leur
 * dire : reçu, encore valable (devant, ou passé de peu), et dans un tournoi
 * planifié par l'arbitrage (un nouvel horaire viendra).
 */
export function clearedHeldStartAt(change: MatchScheduleChange, now: Date = new Date()): string | null {
  if (change.startAt !== null || change.previousStartAt === null || !change.refereeScheduling) return null;
  return heldStartAt(change, now);
}

/** Ligne du journal pour un horaire retiré. */
async function logScheduleCleared(
  row: ScheduledMatchInfoRow,
  change: MatchScheduleChange & { previousStartAt: string },
  now: Date,
): Promise<void> {
  if (change.actor) {
    publishStaffAction(
      formatMatchScheduleClearedLog({
        tournament: { id: Number(row.tournament_id), name: String(row.tournament_name) },
        matchId: change.matchId,
        bracket: String(row.bracket),
        roundNumber: Number(row.round_number),
        swiss: isSwissRound(row),
        ...logEntrants(row),
        previousStartAt: change.previousStartAt,
      }),
      change.actor,
    );
  }
  // Les arbitres avaient reçu « Match programmé » pour cet horaire : l'avis de
  // retrait le remplace sur leur appareil (même étiquette).
  if (!stillCurrent(row, change) || isPlayedMatchStatus(row.status)) return;
  if (!refereesWerePushed(change, now)) return;
  const { pushed } = await notifyStaff({
    topic: "MATCH_SCHEDULED",
    excludeUserIds: change.actor ? [change.actor.id] : [],
    push: (locale) =>
      matchScheduleClearedStaffPush(
        {
          tournamentId: Number(row.tournament_id),
          tournamentName: String(row.tournament_name),
          matchId: change.matchId,
          team1Name: row.team1_name,
          team2Name: row.team2_name,
          solo: toParticipantType(row.participant_type) === "SOLO",
          bracket: String(row.bracket),
          roundNumber: Number(row.round_number),
          swiss: isSwissRound(row),
          startAt: change.previousStartAt,
        },
        locale,
      ),
  });
  // Retiré chez eux : un retrait ne se pousse qu'une fois.
  if (pushed > 0) await forgetStaffPush(change.matchId, change.previousStartAt);
}

/**
 * Les arbitres ont-ils reçu l'horaire retiré ? Seulement s'il est celui que
 * tient la marque `STAFF` (posée quand « Match programmé » les a atteints) —
 * une date seulement journalisée (passée, match joué ou tournoi clos à la
 * pose) n'a rien à remplacer —, et s'il vaut encore (devant, ou passé de moins
 * de 12 h).
 */
export function refereesWerePushed(change: MatchScheduleChange, now: Date = new Date()): boolean {
  if (change.previousStartAt === null || change.staffStartAt === null) return false;
  const previous = new Date(change.previousStartAt).getTime();
  if (!Number.isFinite(previous) || new Date(change.staffStartAt).getTime() !== previous) return false;
  return previous > now.getTime() - HELD_TIME_GRACE_MS;
}

/** Horaire effacé : journal, avis aux arbitres, et aux joueurs qui l'avaient reçu. */
async function notifyScheduleCleared(row: ScheduledMatchInfoRow, change: MatchScheduleChange): Promise<void> {
  const { previousStartAt } = change;
  if (previousStartAt === null) return;
  // Un seul instant pour les joueurs et les arbitres : deux lectures de
  // l'horloge pourraient diverger à la borne des 12 h.
  const now = new Date();
  const held = clearedHeldStartAt(change, now);
  const results = await Promise.allSettled([
    logScheduleCleared(row, { ...change, previousStartAt }, now),
    held !== null && ownsPlayerNotice(row, change) ? announceMatchScheduleCleared(row, held) : Promise.resolve(0),
  ]);
  reportFailures(results, "[notify] horaire retiré non annoncé");
}

/** Un avis manqué se dit dans pm2 ; une table absente (base en création) se tait. */
function reportFailures(results: PromiseSettledResult<unknown>[], label: string): void {
  for (const result of results) {
    if (result.status === "rejected" && !isMissingTableError(result.reason)) console.error(label, result.reason);
  }
}

/**
 * Annonce un horaire posé ou changé, aux joueurs et aux arbitres. Jamais une
 * exception : l'appelant a déjà rendu sa réponse.
 */
export async function notifyMatchScheduleChange(change: MatchScheduleChange): Promise<void> {
  const { startAt } = change;
  if (startAt === change.previousStartAt) return;
  let row: ScheduledMatchInfoRow | null;
  try {
    row = await loadMatchInfo(change.matchId);
  } catch (error) {
    reportFailures([{ status: "rejected", reason: error }], "[notify] horaire de match non annoncé");
    // L'observation posée avec la date ferait taire le balayage : rendue, il
    // annoncera la manche (au meilleur effort — la base peut être injoignable).
    // Pas quand la date est rendue à l'horaire que les joueurs tiennent :
    // `setMatchStartAt` a alors gardé les marques telles quelles.
    if (startAt !== null && change.toldStartAt !== startAt) {
      await releaseDatedMarks(change.matchId, [MATCH_SEEN_KEY], startAt);
    }
    return;
  }
  if (!row) return;
  if (startAt === null) {
    await notifyScheduleCleared(row, change);
    return;
  }
  // Une date déjà passée (correction d'archive) n'est que journalisée. Une
  // date rendue à l'horaire que les joueurs tiennent déjà (après une saisie de
  // travers seulement journalisée) ne leur apprend rien : ils n'en reçoivent
  // pas d'annonce.
  const announceable = isAnnounceableSchedule(change);
  const playersAlreadyHoldIt = change.alreadyAnnounced && change.toldStartAt === startAt;
  const results = await Promise.allSettled([
    announceable && !playersAlreadyHoldIt && ownsPlayerNotice(row, change)
      ? announceMatchSchedule(row, playerAnnouncement(change))
      : Promise.resolve(0),
    notifyReferees(row, { ...change, startAt }, announceable && stillCurrent(row, change)),
  ]);
  reportFailures(results, "[notify] horaire de match non annoncé");
}
