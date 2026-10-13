/**
 * Ce que produit un horaire de match posé ou changé par l'arbitrage
 * (`setMatchStartAt`) : l'annonce aux joueurs, la notification aux arbitres et
 * la ligne du journal Discord.
 *
 * - **Joueurs** des deux engagées : message privé Discord et push
 *   `MATCH_REMINDER` (« Match programmé » / « Match reprogrammé »), par
 *   `announceMatchSchedule` — qui réserve la marque d'observation et évite le
 *   doublon avec le balayage des rappels.
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
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { notifyStaff } from "@/lib/server/notify";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { formatMatchScheduleClearedLog, formatMatchScheduledLog } from "@/lib/shared/bot-logs";
import type { ScheduleAnnouncement } from "@/lib/shared/discord-notifications";
import type { LogEntrant, StaffActor } from "@/lib/shared/log-privacy";
import { toParticipantType } from "@/lib/shared/participants";
import { matchScheduleClearedStaffPush, matchScheduledStaffPush } from "@/lib/shared/push-messages";
import { announceMatchSchedule, announceMatchScheduleCleared } from "./match-reminders";

type ScheduledMatchInfoRow = RowDataPacket & {
  id: number;
  status: string;
  tournament_id: number;
  tournament_name: string;
  participant_type: string;
  bracket: string;
  round_number: number;
  team1_name: string | null;
  team2_name: string | null;
};

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
   * Le tournoi est planifié par l'arbitrage. Sans l'option, un match sans
   * horaire part en lancement : un horaire retiré ne sera pas remplacé, et
   * l'avis « le nouvel horaire te sera annoncé » mentirait (le départ du match,
   * `MATCH_START`, prévient les joueurs).
   */
  refereeScheduling: boolean;
  /** Auteur du geste, `null` hors d'une requête du staff. */
  actor: StaffActor | null;
};

/**
 * Ce que l'annonce dit aux **joueurs** : « reprogrammé », avec l'ancienne date,
 * seulement s'ils avaient reçu un horaire — une date posée quand une place était
 * encore vide, jamais annoncée, ne se cite pas.
 */
export function playerAnnouncement(change: MatchScheduleChange, now: Date = new Date()): ScheduleAnnouncement {
  if (!change.alreadyAnnounced) return { rescheduled: false, previousStartAt: null };
  // Une date d'avant déjà passée n'a été que journalisée (correction
  // d'archive, saisie de travers) : les joueurs ne l'ont jamais reçue, on ne
  // la leur cite pas.
  const previous = change.previousStartAt === null ? Number.NaN : new Date(change.previousStartAt).getTime();
  return { rescheduled: true, previousStartAt: previous > now.getTime() ? change.previousStartAt : null };
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

async function loadMatchInfo(matchId: number): Promise<ScheduledMatchInfoRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<ScheduledMatchInfoRow[]>(
    `SELECT m.id, m.tournament_id, m.bracket, m.round_number, m.status,
            t.name AS tournament_name, t.participant_type,
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

/** La rencontre a eu lieu : jouée, ou score saisi en attente de confirmation. */
function isPlayed(status: string): boolean {
  return status === "COMPLETED" || status === "AWAITING_CONFIRMATION";
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
async function notifyReferees(change: MatchScheduleChange & { startAt: string }, push: boolean): Promise<number> {
  const row = await loadMatchInfo(change.matchId);
  if (!row) return 0;
  const participantType = toParticipantType(row.participant_type);
  const { team1, team2 } = logEntrants(row);
  const announcement = staffAnnouncement(change);
  const tournament = { id: Number(row.tournament_id), name: String(row.tournament_name) };

  const line = formatMatchScheduledLog({
    tournament,
    matchId: change.matchId,
    bracket: String(row.bracket),
    roundNumber: Number(row.round_number),
    team1,
    team2,
    startAt: change.startAt,
    previousStartAt: change.previousStartAt,
    rescheduled: announcement.rescheduled,
  });
  if (change.actor) publishStaffAction(line, change.actor);
  // Un match joué ne se rejouera pas : la date est une correction d'archive,
  // tracée au journal mais annoncée à personne (les joueurs non plus).
  if (!push || isPlayed(row.status)) return 0;

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
          startAt: change.startAt,
        },
        announcement,
        locale,
      ),
  });
  return pushed;
}

/**
 * L'horaire effacé mérite-t-il d'être annoncé aux joueurs ? Reçu, encore
 * devant, et dans un tournoi planifié par l'arbitrage (un nouvel horaire
 * viendra).
 */
export function isAnnounceableClearing(change: MatchScheduleChange, now: Date = new Date()): boolean {
  if (change.startAt !== null || change.previousStartAt === null) return false;
  if (!change.alreadyAnnounced || !change.refereeScheduling) return false;
  const previous = new Date(change.previousStartAt).getTime();
  return Number.isFinite(previous) && previous > now.getTime();
}

/** Ligne du journal pour un horaire retiré. */
async function logScheduleCleared(change: MatchScheduleChange & { previousStartAt: string }): Promise<void> {
  const row = await loadMatchInfo(change.matchId);
  if (!row) return;
  if (change.actor) {
    publishStaffAction(
      formatMatchScheduleClearedLog({
        tournament: { id: Number(row.tournament_id), name: String(row.tournament_name) },
        matchId: change.matchId,
        bracket: String(row.bracket),
        roundNumber: Number(row.round_number),
        ...logEntrants(row),
        previousStartAt: change.previousStartAt,
      }),
      change.actor,
    );
  }
  // Les arbitres avaient reçu « Match programmé » pour cet horaire encore
  // devant : l'avis de retrait le remplace sur leur appareil (même étiquette).
  const previous = new Date(change.previousStartAt).getTime();
  if (isPlayed(row.status) || !Number.isFinite(previous) || previous <= Date.now()) return;
  await notifyStaff({
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
          startAt: change.previousStartAt,
        },
        locale,
      ),
  });
}

/** Horaire effacé : journal, avis aux arbitres, et aux joueurs qui l'avaient reçu. */
async function notifyScheduleCleared(change: MatchScheduleChange): Promise<void> {
  const { previousStartAt } = change;
  if (previousStartAt === null) return;
  const results = await Promise.allSettled([
    logScheduleCleared({ ...change, previousStartAt }),
    isAnnounceableClearing(change) ? announceMatchScheduleCleared(change.matchId, previousStartAt) : Promise.resolve(0),
  ]);
  for (const result of results) {
    if (result.status === "rejected" && !isMissingTableError(result.reason)) {
      console.error("[notify] horaire retiré non annoncé", result.reason);
    }
  }
}

/**
 * Annonce un horaire posé ou changé, aux joueurs et aux arbitres. Jamais une
 * exception : l'appelant a déjà rendu sa réponse.
 */
export async function notifyMatchScheduleChange(change: MatchScheduleChange): Promise<void> {
  const { startAt } = change;
  if (startAt === null) {
    await notifyScheduleCleared(change);
    return;
  }
  if (startAt === change.previousStartAt) return;
  // Une date déjà passée (correction d'archive) n'est que journalisée.
  const announceable = isAnnounceableSchedule(change);
  const results = await Promise.allSettled([
    announceable ? announceMatchSchedule(change.matchId, playerAnnouncement(change)) : Promise.resolve(0),
    notifyReferees({ ...change, startAt }, announceable),
  ]);
  for (const result of results) {
    if (result.status === "rejected" && !isMissingTableError(result.reason)) {
      console.error("[notify] horaire de match non annoncé", result.reason);
    }
  }
}
