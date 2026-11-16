/**
 * Bascule de l'option « Check-in des matchs » d'un tournoi
 * (`docs/features/MATCH_CHECK_IN_SETTING.md`). La règle d'envoi vit dans
 * `lib/shared/match-check-in.ts` ; les balayages la relisent à chaque passage
 * (`./lobby-brief`, `./match-reminders`).
 */
import type { RowDataPacket } from "mysql2/promise";
import { CHECK_IN_REMINDER_KEY, MATCH_REMINDER_OFFSETS, MATCH_SEEN_KEY } from "@/lib/shared/discord-notifications";
import { readDbInstant } from "@/lib/shared/match-check-in";
import { canToggleLiveTournamentOption } from "@/lib/shared/tournament-state";
import type { TournamentState } from "@/lib/shared/types";
import { noteCheckInToggle } from "./check-in-toggles";
import { retryOnDeadlock } from "./deadlock-retry";
import { silencePausedLobbyBriefs } from "./lobby-brief";
import { publishUpdatedEvent } from "./notifications";
import { lockTournamentRow } from "./registration";
import { inTransaction } from "./transaction";

export type MatchCheckInResult = {
  tournamentId: number;
  enabled: boolean;
  /** L'option a réellement changé (le journal ne note que ce cas). */
  changed: boolean;
};

type CheckInRow = RowDataPacket & {
  state: TournamentState;
  match_check_in: number | null;
  match_check_in_paused_at: Date | string | null;
};

/** Avance du rappel qui porte le check-in (10 h), en millisecondes. */
function checkInReminderLeadMs(): number {
  return (MATCH_REMINDER_OFFSETS.find((offset) => offset.key === CHECK_IN_REMINDER_KEY)?.minutesBefore ?? 0) * 60_000;
}

/**
 * Réserve sans message le rappel 10 h des manches du tournoi **déjà
 * annoncées** (marque d'observation), à venir, dont la fenêtre s'est ouverte
 * **pendant l'arrêt** — entre le dernier arrêt et maintenant : coup d'envoi
 * dans moins de 10 h, mais au moins 10 h après l'arrêt. Un rappel dû avant
 * l'arrêt, que le balayage n'a pas encore pris, part donc comme prévu ; une
 * manche annoncée après la remise en marche n'a pas de marque d'observation
 * ici et garde le sien. Ni statut ni engagées ne filtrent : taire le rappel
 * d'une manche jouée ne coûte rien, et une manche rendue jouable ensuite (score
 * refusé) ne doit pas recevoir un rappel dû pendant l'arrêt. La marque porte
 * l'horaire de la manche, comme celles du balayage — une reprogrammation
 * l'efface et rouvre le rappel. Bornes calculées par le processus, comme les
 * horaires. Paramètres : clé du palier, clé d'observation, tournoi, instant
 * présent, instant + 10 h, ouverture la plus ancienne à taire (arrêt + 10 h).
 */
const OPENED_REMINDER_WINDOW_SQL = `m.tournament_id = ? AND m.start_at > ? AND m.start_at <= ? AND m.start_at >= ?`;

/**
 * Les manches à taire, lues **sans verrou** : l'`INSERT … SELECT` verrouille
 * chaque ligne qu'il parcourt (lignes de manche, marques que le balayage pose),
 * il ne doit donc parcourir que celles-ci, par clé primaire, et non tout le
 * tournoi sous son verrou. Le filtre sur le tournoi passe par l'index de
 * `tournament_id` (préfixe de `idx_bg_matches_phase_round`) : un tournoi compte
 * des dizaines de manches, un index `(tournament_id, start_at)` de plus
 * alourdirait chaque écriture de match pour rien.
 */
const SELECT_OPENED_REMINDERS_SQL = `SELECT m.id FROM bg_matches m
       JOIN bg_match_reminders seen ON seen.match_id = m.id AND seen.offset_key = ?
      WHERE ${OPENED_REMINDER_WINDOW_SQL}`;

const SILENCE_OPENED_REMINDERS_SQL = (idCount: number): string => `INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at)
     SELECT m.id, ?, m.start_at FROM bg_matches m
       JOIN bg_match_reminders seen ON seen.match_id = m.id AND seen.offset_key = ?
      WHERE m.id IN (${Array.from({ length: idCount }, () => "?").join(", ")}) AND ${OPENED_REMINDER_WINDOW_SQL}`;

/**
 * Allume ou éteint le check-in des matchs, à tout moment jusqu'à la clôture
 * (en cours compris). Éteinte, l'option date son arrêt
 * (`match_check_in_paused_at`, heure du processus, comme les horaires de
 * match) : rien de ce qui devient dû jusqu'à la remise en marche ne part. Le rappel 10 h des
 * manches déjà annoncées dont la fenêtre s'est ouverte pendant l'arrêt est
 * réservé **sans message** dans la même transaction
 * ({@link SILENCE_OPENED_REMINDERS_SQL}), comme le check-in de H-15 devenu dû
 * pendant l'arrêt (`silencePausedLobbyBriefs`) : chaque arrêt est soldé à sa
 * remise en marche, plusieurs arrêts ne se confondent pas. Sans arrêt daté
 * (tournoi créé sans check-in), tout l'avant compte pour l'arrêt. Rejouée sur
 * un interblocage avec un balayage qui réserve la même marque, l'instant
 * présent repris à chaque tentative (`now` des tests, sinon l'horloge) : une
 * tentative rejouée après une attente ne borne pas l'arrêt trop tard. Validée,
 * la bascule le note (`noteCheckInToggle`) : un envoi lancé ensuite relit l'option.
 *
 * @throws `TOURNAMENT_NOT_FOUND` | `TOURNAMENT_FINISHED`
 */
export async function setMatchCheckIn(
  tournamentId: number,
  enabled: boolean,
  fixedNow?: Date,
): Promise<MatchCheckInResult> {
  const changed = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const now = fixedNow ?? new Date();
      // Verrou en toute première instruction (piège `REPEATABLE READ`).
      await lockTournamentRow(connection, tournamentId);
      const [rows] = await connection.execute<CheckInRow[]>(
        `SELECT state, match_check_in, match_check_in_paused_at FROM bg_tournaments WHERE id = ? LIMIT 1`,
        [tournamentId],
      );
      const tournament = rows[0];
      if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
      if (!canToggleLiveTournamentOption(tournament.state)) throw new Error("TOURNAMENT_FINISHED");
      const current = Number(tournament.match_check_in ?? 1) !== 0;
      if (current === enabled) return false;
      if (!enabled) {
        await connection.execute(
          `UPDATE bg_tournaments SET match_check_in = 0, match_check_in_paused_at = ? WHERE id = ?`,
          [now, tournamentId],
        );
        return true;
      }
      await connection.execute(
        `UPDATE bg_tournaments SET match_check_in = 1 WHERE id = ?`,
        [tournamentId],
      );
      const pausedAt = readDbInstant(tournament.match_check_in_paused_at);
      const lead = checkInReminderLeadMs();
      const window = [
        tournamentId,
        now,
        new Date(now.getTime() + lead),
        pausedAt ? new Date(pausedAt.getTime() + lead) : now,
      ];
      const [opened] = await connection.execute<RowDataPacket[]>(SELECT_OPENED_REMINDERS_SQL, [MATCH_SEEN_KEY, ...window]);
      if (opened.length > 0) {
        const ids = opened.map((row) => Number(row.id));
        await connection.execute(SILENCE_OPENED_REMINDERS_SQL(ids.length), [
          CHECK_IN_REMINDER_KEY,
          MATCH_SEEN_KEY,
          ...ids,
          ...window,
        ]);
      }
      await silencePausedLobbyBriefs(connection, tournamentId, pausedAt, now);
      return true;
    }),
  );
  if (changed) {
    // Aussitôt validée : aucun envoi lancé désormais ne rejoint une relecture partie avant.
    noteCheckInToggle();
    publishUpdatedEvent(tournamentId);
  }
  return { tournamentId, enabled, changed };
}
