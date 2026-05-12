import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { TournamentState } from "@/lib/shared/types";
import { TournamentRow, RegistrationRow, MatchRow, TournamentListRow } from "./_internal";

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
      has_third_place_match
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
): Promise<number> {
  const [insert] = await connection.execute<ResultSetHeader>(
    `INSERT INTO bg_matches (tournament_id, bracket, round_number, match_number)
     VALUES (?, ?, ?, ?)`,
    [tournamentId, bracket, roundNumber, matchNumber],
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

export async function finishTournament(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  await connection.execute(
    `UPDATE bg_tournaments
     SET state = 'FINISHED', finished_at = NOW()
     WHERE id = ?`,
    [tournamentId],
  );
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
      m.updated_at
     FROM bg_matches m
     LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
     LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
     WHERE m.tournament_id = ?
     ORDER BY
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
      t.has_third_place_match`,
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
