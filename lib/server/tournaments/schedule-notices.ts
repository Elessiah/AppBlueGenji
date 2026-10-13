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
 * Rien ne part pour une date effacée, inchangée, ou déjà passée (correction
 * d'archive). Tout est au meilleur effort et après le commit : l'horaire est
 * enregistré, une panne de notification n'y change rien.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { notifyStaff } from "@/lib/server/notify";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { formatMatchScheduledLog } from "@/lib/shared/bot-logs";
import type { LogEntrant, StaffActor } from "@/lib/shared/log-privacy";
import { toParticipantType } from "@/lib/shared/participants";
import { matchScheduledStaffPush } from "@/lib/shared/push-messages";
import { announceMatchSchedule } from "./match-reminders";

type ScheduledMatchInfoRow = RowDataPacket & {
  id: number;
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
  /** Auteur du geste, `null` hors d'une requête du staff. */
  actor: StaffActor | null;
};

/** L'horaire mérite-t-il d'être annoncé ? Posé, changé, et encore devant. */
export function isAnnounceableSchedule(change: MatchScheduleChange, now: Date = new Date()): boolean {
  if (change.startAt === null || change.startAt === change.previousStartAt) return false;
  const start = new Date(change.startAt).getTime();
  return Number.isFinite(start) && start > now.getTime();
}

async function loadMatchInfo(matchId: number): Promise<ScheduledMatchInfoRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<ScheduledMatchInfoRow[]>(
    `SELECT m.id, m.tournament_id, m.bracket, m.round_number,
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

/** Prévient les arbitres et écrit la ligne du journal. */
async function notifyReferees(change: MatchScheduleChange & { startAt: string }): Promise<number> {
  const row = await loadMatchInfo(change.matchId);
  if (!row) return 0;
  const participantType = toParticipantType(row.participant_type);
  const entrant = (name: string | null): LogEntrant | null => (name === null ? null : { name, participantType });
  const rescheduled = change.previousStartAt !== null;
  const tournament = { id: Number(row.tournament_id), name: String(row.tournament_name) };

  const line = formatMatchScheduledLog({
    tournament,
    matchId: change.matchId,
    bracket: String(row.bracket),
    roundNumber: Number(row.round_number),
    team1: entrant(row.team1_name),
    team2: entrant(row.team2_name),
    startAt: change.startAt,
    previousStartAt: change.previousStartAt,
  });
  if (change.actor) publishStaffAction(line, change.actor);

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
        rescheduled,
        locale,
      ),
  });
  return pushed;
}

/**
 * Annonce un horaire posé ou changé, aux joueurs et aux arbitres. Jamais une
 * exception : l'appelant a déjà rendu sa réponse.
 */
export async function notifyMatchScheduleChange(change: MatchScheduleChange): Promise<void> {
  const { startAt } = change;
  if (startAt === null || !isAnnounceableSchedule(change)) return;
  const results = await Promise.allSettled([
    announceMatchSchedule(change.matchId, change.previousStartAt !== null),
    notifyReferees({ ...change, startAt }),
  ]);
  for (const result of results) {
    if (result.status === "rejected" && !isMissingTableError(result.reason)) {
      console.error("[notify] horaire de match non annoncé", result.reason);
    }
  }
}
