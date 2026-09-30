/**
 * Bascule de l'option « matchs planifiés par l'arbitrage »
 * (`bg_tournaments.referee_scheduling`), à tout moment avant la clôture —
 * tournoi en cours compris.
 *
 * La phase d'un match se **dérive** de l'option (`matchLaunchPhase`) : allumer
 * l'option fait passer « à planifier » tout match non lancé et sans date, et les
 * manches à venir naissent à planifier ; l'éteindre rend ces matchs au
 * lancement ordinaire. Une seule écriture accompagne la bascule : à
 * l'allumage, l'état de lancement (ouverture, « Prêt ») des matchs qui repassent
 * à planifier est effacé — il appartenait à un lancement qui n'a plus lieu, et
 * l'ouverture restée en base ferait partir le match d'office dès sa
 * planification, le délai de quinze minutes étant déjà écoulé.
 *
 * Un match déjà **lancé** n'est jamais touché : il se joue, ses engagés
 * reportent déjà leur score.
 *
 * Voir `docs/features/MATCH_PLANNING.md`.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { canToggleRefereeScheduling } from "@/lib/shared/match-planning";
import type { TournamentState } from "@/lib/shared/types";
import { publishUpdatedEvent } from "./notifications";

export type RefereeSchedulingResult = {
  tournamentId: number;
  tournamentName: string;
  enabled: boolean;
  /** Matchs non lancés, sans date, dont le lancement a été défait (allumage). */
  movedToPlanning: number;
};

/**
 * @throws `TOURNAMENT_NOT_FOUND` | `TOURNAMENT_FINISHED`
 */
export async function setRefereeScheduling(
  tournamentId: number,
  enabled: boolean,
): Promise<RefereeSchedulingResult> {
  const result = await withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      // Verrou en **toute première instruction** (piège `REPEATABLE READ` : la
      // première lecture ordinaire figerait l'instantané avant l'attente). Il
      // sérialise la bascule avec l'entretien du tournoi, qui le prend aussi.
      const [rows] = await connection.execute<
        (RowDataPacket & { name: string; state: TournamentState; referee_scheduling: number })[]
      >(
        `SELECT name, state, referee_scheduling FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE`,
        [tournamentId],
      );
      const tournament = rows[0];
      if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
      if (!canToggleRefereeScheduling(tournament.state)) throw new Error("TOURNAMENT_FINISHED");

      await connection.execute(`UPDATE bg_tournaments SET referee_scheduling = ? WHERE id = ?`, [
        enabled ? 1 : 0,
        tournamentId,
      ]);

      let movedToPlanning = 0;
      if (enabled) {
        // Mêmes conditions que la phase `TO_PLAN` : jouable (`READY`, deux
        // engagées), sans date, jamais lancé. Un lancement posé pour un autre
        // appariement ne lance pas celui-ci (`currentLaunchState`) : il est
        // défait avec le reste.
        const [update] = await connection.execute<ResultSetHeader>(
          `UPDATE bg_matches
           SET lobby_opened_at = NULL, launched_at = NULL, team1_ready_at = NULL,
               team2_ready_at = NULL, caster_ready_at = NULL
           WHERE tournament_id = ? AND status = 'READY' AND start_at IS NULL
             AND team1_id IS NOT NULL AND team2_id IS NOT NULL
             AND (launched_at IS NULL
                  OR NOT (launch_pairing <=> CONCAT(team1_id, ':', team2_id)))`,
          [tournamentId],
        );
        movedToPlanning = Number(update.affectedRows ?? 0);
      }

      await connection.commit();
      return { tournamentName: tournament.name, movedToPlanning };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    }
  });

  // La carte change (l'option y est publique) : listes et instantané suivent.
  publishUpdatedEvent(tournamentId);
  return { tournamentId, enabled, ...result };
}
