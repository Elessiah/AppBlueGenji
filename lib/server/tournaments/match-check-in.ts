/**
 * Bascule de l'option « Check-in des matchs » d'un tournoi
 * (`docs/features/MATCH_CHECK_IN_SETTING.md`). La règle d'envoi vit dans
 * `lib/shared/match-check-in.ts` ; les balayages la relisent à chaque passage
 * (`./lobby-brief`, `./match-reminders`).
 */
import type { RowDataPacket } from "mysql2/promise";
import { CHECK_IN_REMINDER_KEY, MATCH_REMINDER_OFFSETS, MATCH_SEEN_KEY } from "@/lib/shared/discord-notifications";
import { canToggleMatchCheckIn } from "@/lib/shared/match-check-in";
import { PLAYED_MATCH_STATUSES } from "@/lib/shared/match-schedule";
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

/** Avance du rappel qui porte le check-in (10 h). */
function checkInReminderMinutes(): number {
  return MATCH_REMINDER_OFFSETS.find((offset) => offset.key === CHECK_IN_REMINDER_KEY)?.minutesBefore ?? 0;
}

/** Statuts d'une manche jouée, en liste SQL. */
const PLAYED_STATUS_LIST = PLAYED_MATCH_STATUSES.map((status) => "'" + status + "'").join(", ");

/**
 * Réserve sans message le rappel 10 h des manches du tournoi **déjà
 * annoncées** (marque d'observation), à venir, non jouées, aux deux engagées
 * connues, dont la fenêtre est ouverte (coup d'envoi dans moins de 10 h) : il
 * était dû pendant l'arrêt. La marque porte l'horaire de la manche, comme
 * celles du balayage — une reprogrammation l'efface et rouvre le rappel.
 * Bornes calculées par le processus (`now`), comme les horaires.
 * Paramètres : clé du palier, clé d'observation, tournoi, instant présent,
 * instant + 10 h.
 */
const SILENCE_OPENED_REMINDERS_SQL = `INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at)
     SELECT m.id, ?, m.start_at FROM bg_matches m
       JOIN bg_match_reminders seen ON seen.match_id = m.id AND seen.offset_key = ?
      WHERE m.tournament_id = ? AND m.start_at > ? AND m.start_at <= ?
        AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
        AND m.status NOT IN (${PLAYED_STATUS_LIST})`;

/**
 * Allume ou éteint le check-in des matchs, à tout moment jusqu'à la clôture
 * (en cours compris). Rallumée, l'option date sa remise en marche
 * (`match_check_in_resumed_at`, heure du processus comme les horaires de
 * match) : rien de ce qui était dû avant ne part. Le rappel 10 h des manches
 * déjà annoncées dont la fenêtre est ouverte est réservé **sans message** dans
 * la même transaction ({@link SILENCE_OPENED_REMINDERS_SQL}) : seul ce qui
 * était dû pendant l'arrêt se tait — une manche connue ou programmée après la
 * remise en marche garde son rappel.
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
      await connection.execute(SILENCE_OPENED_REMINDERS_SQL, [
        CHECK_IN_REMINDER_KEY,
        MATCH_SEEN_KEY,
        tournamentId,
        now,
        new Date(now.getTime() + checkInReminderMinutes() * 60_000),
      ]);
    } else {
      await connection.execute(`UPDATE bg_tournaments SET match_check_in = 0 WHERE id = ?`, [tournamentId]);
    }
    return true;
  });
  if (changed) publishUpdatedEvent(tournamentId);
  return { tournamentId, enabled, changed };
}
