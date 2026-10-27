/**
 * Journal des gestes du staff qui ne laissaient aucune trace
 * (`docs/features/STAFF_ACTION_LOGS.md`) : une ligne au journal du staff sur
 * Discord (`/internal/log`), **sans personne nommée** — ni l'auteur (« le
 * staff »), ni un joueur en tournoi individuel — et sans ligne nominative dans
 * pm2 (décision du 27 octobre 2026). Aucun push, aucun message privé : le
 * journal suffit, ces gestes n'appellent l'intervention de personne.
 *
 * Appelé par les routes **après** le geste réussi, sans attendre : le bot est
 * optionnel, et un envoi lent n'a pas à retarder la réponse. Ne lève jamais.
 */
import type { RowDataPacket } from "mysql2/promise";
import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import {
  formatStaffMatchActionLog,
  formatStaffTournamentActionLog,
  type StaffActionAuthor,
  type StaffMatchAction,
  type StaffTournamentAction,
} from "@/lib/shared/bot-logs";
import { can } from "@/lib/shared/permissions";
import { loadMatchLogRow, matchLogSubject } from "./match-log-subject";

/**
 * Auteur anonyme d'un geste : « le staff » pour qui détient la permission
 * `tournaments`, « un caster » pour qui n'a que la diffusion (`live`).
 */
export function staffActionAuthor(user: Parameters<typeof can>[0]): StaffActionAuthor {
  return can(user, "tournaments") ? "STAFF" : "CASTER";
}

/** Options d'une ligne de match : `withoutMatch`, le tournoi seul (`formatStaffMatchActionLog`). */
export type StaffMatchActionOptions = { withoutMatch?: boolean };

/** La ligne d'un geste sur un match ; rien si le match n'existe plus. Peut lever. */
export async function deliverStaffMatchAction(
  matchId: number,
  action: StaffMatchAction,
  author: StaffActionAuthor = "STAFF",
  options: StaffMatchActionOptions = {},
): Promise<void> {
  const row = await loadMatchLogRow(matchId);
  if (!row) return;
  const match = matchLogSubject(row);
  await sendBotLog(
    formatStaffMatchActionLog({
      tournament: match.tournament,
      matchId: match.matchId,
      bracket: match.bracket,
      roundNumber: match.roundNumber,
      swiss: match.swiss,
      team1: match.team1,
      team2: match.team2,
      action,
      author,
      withoutMatch: options.withoutMatch,
    }),
  );
}

type TournamentNameRow = RowDataPacket & { id: number; name: string };

/** La ligne d'un geste sur un tournoi ; rien si le tournoi n'existe plus. Peut lever. */
export async function deliverStaffTournamentAction(
  tournamentId: number,
  action: StaffTournamentAction,
  count?: number,
): Promise<void> {
  const db = await getDatabase();
  const [rows] = await db.execute<TournamentNameRow[]>("SELECT id, name FROM bg_tournaments WHERE id = ? LIMIT 1", [
    tournamentId,
  ]);
  const tournament = rows[0];
  if (!tournament) return;
  await sendBotLog(
    formatStaffTournamentActionLog({ tournament: { id: Number(tournament.id), name: tournament.name }, action, count }),
  );
}

/** Journalise un geste du staff sur un match, sans attendre ; ne lève jamais. */
export function announceStaffMatchAction(
  matchId: number,
  action: StaffMatchAction,
  author: StaffActionAuthor = "STAFF",
  options: StaffMatchActionOptions = {},
): void {
  void deliverStaffMatchAction(matchId, action, author, options).catch((error) =>
    console.error(`[staff-log] geste ${action} sur le match #${matchId} non journalisé`, error),
  );
}

/** Journalise un geste du staff sur un tournoi, sans attendre ; ne lève jamais. */
export function announceStaffTournamentAction(tournamentId: number, action: StaffTournamentAction, count?: number): void {
  void deliverStaffTournamentAction(tournamentId, action, count).catch((error) =>
    console.error(`[staff-log] geste ${action} sur le tournoi #${tournamentId} non journalisé`, error),
  );
}
