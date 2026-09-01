import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { TournamentState } from "@/lib/shared/types";
import { forfeitMapCount, parseMatchFormat, type MatchFormat } from "@/lib/shared/match-format";
import { TournamentRow, RegistrationRow, MatchRow, TournamentListRow } from "./_internal";
import { queueBotLog } from "./bot-logs";

/**
 * Format de match du tournoi (`null` = saisie libre).
 *
 * Il se lit sur le **tournoi**, phases comprises : le réglage vaut pour toute la
 * compétition (`docs/features/MATCH_FORMAT.md`), une phase n'en redéfinit pas.
 */
export async function loadTournamentMatchFormat(
  connection: PoolConnection,
  tournamentId: number,
): Promise<MatchFormat | null> {
  const [rows] = await connection.execute<
    (RowDataPacket & { match_format_type: "BO" | "FT" | null; match_format_value: number | null })[]
  >(
    `SELECT match_format_type, match_format_value
     FROM bg_tournaments
     WHERE id = ?
     LIMIT 1`,
    [tournamentId],
  );

  const row = rows[0];
  if (!row) return null;
  return parseMatchFormat(row.match_format_type, row.match_format_value);
}

/**
 * Score à inscrire sur un match clos par forfait : le score plein du format
 * (FT3 → 3-0), l'équipe partie restant à zéro.
 *
 * Commodité pour les appelants qui n'ont pas déjà le format sous la main —
 * l'arbitrage, l'abandon en Survie et en Ronde suisse. La règle, elle, tient
 * dans `forfeitMapCount` (`lib/shared/match-format.ts`) : c'est elle qu'applique
 * aussi `forfeitEnduranceTeam`, qui lit le format avec le reste de son tournoi.
 *
 * Ces chemins écrivaient auparavant leur propre chiffre — un 1-0 en dur pour la
 * Survie et la Ronde suisse — si bien qu'un même forfait s'affichait « 1 – FF »
 * sur la manche pendant que la fiche de l'adversaire en comptait trois maps, le
 * bilan dérivant du format.
 */
export async function forfeitMatchScores(
  connection: PoolConnection,
  tournamentId: number,
  team1Forfeits: boolean,
): Promise<{ team1Score: number; team2Score: number }> {
  const maps = forfeitMapCount(await loadTournamentMatchFormat(connection, tournamentId));

  return {
    team1Score: team1Forfeits ? 0 : maps,
    team2Score: team1Forfeits ? maps : 0,
  };
}

export async function loadTournamentRow(
  connection: PoolConnection,
  tournamentId: number,
): Promise<TournamentRow | null> {
  const [rows] = await connection.execute<TournamentRow[]>(
    `SELECT
      id,
      organizer_user_id,
      name,
      description,
      format,
      game,
      max_teams,
      state,
      start_visibility_at,
      registration_open_at,
      registration_close_at,
      start_at,
      bracket_size,
      created_at,
      finished_at,
      has_third_place_match,
      survival_rounds_before_first_cut,
      survival_rounds_per_cut,
      survival_current_round,
      current_phase_id,
      manual_seeding,
      participant_type,
      match_format_type,
      match_format_value,
      live_url
     FROM bg_tournaments
     WHERE id = ?
     LIMIT 1`,
    [tournamentId],
  );

  return rows.length === 0 ? null : rows[0];
}

export async function loadRegisteredTeamIds(
  connection: PoolConnection,
  tournamentId: number,
): Promise<number[]> {
  const [rows] = await connection.execute<
    (RowDataPacket & { team_id: number; seed: number | null; registered_at: Date })[]
  >(
    `SELECT team_id, seed, registered_at
     FROM bg_tournament_registrations
     WHERE tournament_id = ?
     ORDER BY COALESCE(seed, 1000000), registered_at ASC`,
    [tournamentId],
  );

  return rows.map((row) => Number(row.team_id));
}

export async function createMatch(
  connection: PoolConnection,
  tournamentId: number,
  bracket: "UPPER" | "LOWER" | "GRAND" | "THIRD_PLACE",
  roundNumber: number,
  matchNumber: number,
  phaseId = 0,
): Promise<number> {
  const [insert] = await connection.execute<ResultSetHeader>(
    `INSERT INTO bg_matches (tournament_id, bracket, round_number, match_number, phase_id)
     VALUES (?, ?, ?, ?, ?)`,
    [tournamentId, bracket, roundNumber, matchNumber, phaseId],
  );

  return Number(insert.insertId);
}

export async function setMatchParticipants(
  connection: PoolConnection,
  matchId: number,
  team1Id: number | null,
  team2Id: number | null,
  status: "PENDING" | "READY",
): Promise<void> {
  await connection.execute(
    `UPDATE bg_matches
     SET team1_id = ?,
         team2_id = ?,
         status = ?
     WHERE id = ?`,
    [team1Id, team2Id, status, matchId],
  );
}

export async function updateTournamentState(
  connection: PoolConnection,
  tournamentId: number,
  state: TournamentState,
): Promise<void> {
  await connection.execute(`UPDATE bg_tournaments SET state = ? WHERE id = ?`, [
    state,
    tournamentId,
  ]);
}

export async function updateTournamentBracketSize(
  connection: PoolConnection,
  tournamentId: number,
  bracketSize: number,
): Promise<void> {
  await connection.execute(`UPDATE bg_tournaments SET bracket_size = ? WHERE id = ?`, [
    bracketSize,
    tournamentId,
  ]);
}

/**
 * Clôt un tournoi. Point de passage unique de tous les formats (élimination,
 * survie, ronde suisse, endurance, phases), et à ce titre l'endroit où le
 * journal Discord réserve sa ligne de clôture : la championne, elle, est relue
 * après le commit — le classement final s'écrit juste après cet appel.
 */
export async function finishTournament(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  // `state <> 'FINISHED'` fait de la clôture une opération à effet unique. Un
  // tournoi déjà clos peut repasser ici — un arbitre qui corrige le score d'une
  // archive rejoue toute la finalisation —, et sans cette clause il y gagnerait
  // une nouvelle date de clôture (celle de la correction, pas celle du tournoi)
  // et une seconde annonce de sa championne sur Discord.
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE bg_tournaments
     SET state = 'FINISHED', finished_at = NOW()
     WHERE id = ? AND state <> 'FINISHED'`,
    [tournamentId],
  );

  if (result.affectedRows > 0) {
    queueBotLog(connection, { kind: "tournament_finished", tournamentId });
  }
}

export async function getRegistrationRows(
  connection: PoolConnection,
  tournamentId: number,
): Promise<RegistrationRow[]> {
  const [rows] = await connection.execute<RegistrationRow[]>(
    `SELECT
      r.team_id,
      t.name AS team_name,
      t.logo_url,
      r.seed,
      r.final_rank,
      r.registered_at
     FROM bg_tournament_registrations r
     JOIN bg_teams t ON t.id = r.team_id
     WHERE r.tournament_id = ?
     ORDER BY COALESCE(r.seed, 1000000), r.registered_at ASC`,
    [tournamentId],
  );

  return rows;
}

export async function getMatchRows(
  connection: PoolConnection,
  tournamentId: number,
): Promise<MatchRow[]> {
  const [rows] = await connection.execute<MatchRow[]>(
    `SELECT
      m.id,
      m.tournament_id,
      m.bracket,
      m.round_number,
      m.match_number,
      m.status,
      m.team1_id,
      m.team2_id,
      t1.name AS team1_name,
      t2.name AS team2_name,
      m.team1_placeholder,
      m.team2_placeholder,
      m.team1_score,
      m.team2_score,
      m.winner_team_id,
      m.loser_team_id,
      m.forfeit_team_id,
      m.next_winner_match_id,
      m.next_winner_slot,
      m.next_loser_match_id,
      m.next_loser_slot,
      m.team1_report_score,
      m.team1_report_opponent_score,
      m.team1_reported_at,
      m.team2_report_score,
      m.team2_report_opponent_score,
      m.team2_reported_at,
      m.score_deadline_at,
      m.updated_at,
      m.phase_id,
      m.start_at,
      m.live_trigger,
      m.live_url,
      m.live_started_at,
      p.position AS phase_position
     FROM bg_matches m
     LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
     LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
     LEFT JOIN bg_tournament_phases p ON p.id = m.phase_id
     WHERE m.tournament_id = ?
     ORDER BY
      COALESCE(p.position, 0) ASC,
      FIELD(m.bracket, 'UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') ASC,
      m.round_number ASC,
      m.match_number ASC`,
    [tournamentId],
  );

  return rows;
}

export async function getTournamentListRow(
  connection: PoolConnection,
  tournamentId: number,
): Promise<TournamentListRow | null> {
  const [rows] = await connection.execute<TournamentListRow[]>(
    `SELECT
      t.id,
      t.name,
      t.description,
      t.format,
      t.game,
      t.max_teams,
      t.state,
      t.start_visibility_at,
      t.registration_open_at,
      t.registration_close_at,
      t.start_at,
      t.bracket_size,
      t.created_at,
      t.organizer_user_id,
      t.finished_at,
      t.has_third_place_match,
      t.survival_rounds_before_first_cut,
      t.survival_rounds_per_cut,
      t.survival_current_round,
      t.current_phase_id,
      t.participant_type,
      t.match_format_type,
      t.match_format_value,
      t.live_url,
      COALESCE(COUNT(r.id), 0) AS registered_teams
     FROM bg_tournaments t
     LEFT JOIN bg_tournament_registrations r ON r.tournament_id = t.id
     WHERE t.id = ?
     GROUP BY
      t.id,
      t.name,
      t.description,
      t.format,
      t.game,
      t.max_teams,
      t.state,
      t.start_visibility_at,
      t.registration_open_at,
      t.registration_close_at,
      t.start_at,
      t.bracket_size,
      t.created_at,
      t.organizer_user_id,
      t.finished_at,
      t.has_third_place_match,
      t.survival_rounds_before_first_cut,
      t.survival_rounds_per_cut,
      t.survival_current_round,
      t.current_phase_id,
      t.participant_type,
      t.match_format_type,
      t.match_format_value,
      t.live_url`,
    [tournamentId],
  );

  return rows.length === 0 ? null : rows[0];
}

export async function hasExistingMatches(
  connection: PoolConnection,
  tournamentId: number,
): Promise<boolean> {
  const [rows] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches WHERE tournament_id = ?`,
    [tournamentId],
  );

  return Number(rows[0]?.c ?? 0) > 0;
}

export async function deleteAllMatches(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  await connection.execute(`DELETE FROM bg_matches WHERE tournament_id = ?`, [tournamentId]);
}

export async function deletePhaseMatches(
  connection: PoolConnection,
  tournamentId: number,
  phaseId: number,
): Promise<void> {
  await connection.execute(
    `DELETE FROM bg_matches WHERE tournament_id = ? AND phase_id = ?`,
    [tournamentId, phaseId],
  );
}

export async function resetRegistrationRanks(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  await connection.execute(
    `UPDATE bg_tournament_registrations
     SET final_rank = NULL
     WHERE tournament_id = ?`,
    [tournamentId],
  );
}
