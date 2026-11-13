/**
 * Bascule de l'option « Check-in des matchs » d'un tournoi
 * (`docs/features/MATCH_CHECK_IN_SETTING.md`). La règle d'envoi vit dans
 * `lib/shared/match-check-in.ts` ; les balayages la relisent à chaque passage
 * (`./lobby-brief`, `./match-reminders`).
 */
import type { RowDataPacket } from "mysql2/promise";
import { canToggleMatchCheckIn } from "@/lib/shared/match-check-in";
import type { TournamentState } from "@/lib/shared/types";
import { publishUpdatedEvent } from "./notifications";
import { lockTournamentRow } from "./registration";
import { inTransaction } from "./transaction";

export type MatchCheckInResult = {
  tournamentId: number;
  enabled: boolean;
  /** L'option a réellement changé (le journal ne note que ce cas). */
  changed: boolean;
};

type CheckInRow = RowDataPacket & { state: TournamentState; match_check_in: number | null };

/**
 * Allume ou éteint le check-in des matchs, à tout moment jusqu'à la clôture
 * (en cours compris). Rallumée, l'option date sa remise en marche
 * (`match_check_in_resumed_at`, heure du processus comme les horaires de
 * match) : rien de ce qui était dû avant ne part.
 *
 * @throws `TOURNAMENT_NOT_FOUND` | `TOURNAMENT_FINISHED`
 */
export async function setMatchCheckIn(
  tournamentId: number,
  enabled: boolean,
  now: Date = new Date(),
): Promise<MatchCheckInResult> {
  const changed = await inTransaction(async (connection) => {
    // Verrou en toute première instruction (piège `REPEATABLE READ`).
    await lockTournamentRow(connection, tournamentId);
    const [rows] = await connection.execute<CheckInRow[]>(
      `SELECT state, match_check_in FROM bg_tournaments WHERE id = ? LIMIT 1`,
      [tournamentId],
    );
    const tournament = rows[0];
    if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
    if (!canToggleMatchCheckIn(tournament.state)) throw new Error("TOURNAMENT_FINISHED");
    const current = Number(tournament.match_check_in ?? 1) !== 0;
    if (current === enabled) return false;
    if (enabled) {
      await connection.execute(
        `UPDATE bg_tournaments SET match_check_in = 1, match_check_in_resumed_at = ? WHERE id = ?`,
        [now, tournamentId],
      );
    } else {
      await connection.execute(`UPDATE bg_tournaments SET match_check_in = 0 WHERE id = ?`, [tournamentId]);
    }
    return true;
  });
  if (changed) publishUpdatedEvent(tournamentId);
  return { tournamentId, enabled, changed };
}
