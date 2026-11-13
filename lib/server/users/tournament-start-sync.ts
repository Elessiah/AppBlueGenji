import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { failureReason } from "@/lib/server/failure-reason";
import { computeTournamentState, syncTournamentState } from "@/lib/server/tournaments/state";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";

type StateRow = RowDataPacket &
  Pick<TournamentRow, "state" | "finished_at" | "registration_open_at" | "registration_close_at" | "start_at">;

/**
 * Remet à l'heure, **avant** la transaction d'une suppression et sous le seul
 * verrou du tournoi, ceux dont l'état stocké est en retard sur leurs dates.
 *
 * Un coup d'envoi tardif génère le plateau et ses matchs (écritures
 * nombreuses) : fait dans la transaction de suppression, il le ferait sous le
 * verrou du compte (connexions, réactivation, arbitrages en attente) et
 * allongerait la fenêtre d'interblocage. Ici, une courte transaction par
 * tournoi ne retient que lui. Un tournoi déjà à jour ne coûte qu'une lecture
 * sans verrou ; `done` (partagé par une passe entière) évite de relire deux
 * fois le même tournoi quand plusieurs comptes y sont inscrits. Au mieux : un
 * échec est journalisé, et la synchronisation de la transaction de suppression
 * (inchangée) reste le filet. Rend les tournois dont l'état a changé.
 */
export async function startDueTournaments(
  tournamentIds: readonly number[],
  done: Set<number> = new Set(),
): Promise<number[]> {
  const started: number[] = [];
  for (const tournamentId of tournamentIds) {
    if (done.has(tournamentId)) continue;
    done.add(tournamentId);
    try {
      if (await syncIfStale(tournamentId)) started.push(tournamentId);
    } catch (error) {
      console.error(`[deleted-accounts] tournoi #${tournamentId} non remis à l'heure :`, failureReason(error));
    }
  }
  return started;
}

async function syncIfStale(tournamentId: number): Promise<boolean> {
  const pool = await getDatabase();
  const [rows] = await pool.execute<StateRow[]>(
    `SELECT state, finished_at, registration_open_at, registration_close_at, start_at
       FROM bg_tournaments WHERE id = ?`,
    [tournamentId],
  );
  const row = rows[0];
  if (!row || computeTournamentState(row) === row.state) return false;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockTournamentRow(connection, tournamentId);
    const result = await syncTournamentState(connection, tournamentId);
    await connection.commit();
    try {
      flushBotLogs(connection);
    } catch (error) {
      console.error(`[deleted-accounts] annonces du tournoi #${tournamentId} non envoyées :`, failureReason(error));
    }
    if (result.stateChanged) {
      try {
        publishUpdatedEvent(tournamentId);
      } catch (error) {
        console.error(`[deleted-accounts] tournoi #${tournamentId} non prévenu :`, failureReason(error));
      }
    }
    return result.stateChanged;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}
