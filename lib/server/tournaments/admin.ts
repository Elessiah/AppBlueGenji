import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { MatchRow } from "./_internal";
import { finalizeMatch } from "./scoring";
import { tryAutoResolveByes } from "./byes";

export async function checkDownstreamMatchesHaveNoScores(
  connection: PoolConnection,
  match: MatchRow,
): Promise<void> {
  if (match.winner_team_id === null) {
    return;
  }

  const nextWinnerId = match.next_winner_match_id ? Number(match.next_winner_match_id) : null;
  const nextLoserId = match.next_loser_match_id ? Number(match.next_loser_match_id) : null;

  if (nextWinnerId) {
    const [results] = await connection.execute<
      (RowDataPacket & {
        team1_id: number | null;
        team2_id: number | null;
        team1_score: number | null;
        team2_score: number | null;
      })[]
    >(
      `SELECT team1_id, team2_id, team1_score, team2_score FROM bg_matches WHERE id = ? LIMIT 1`,
      [nextWinnerId],
    );
    if (
      results.length > 0 &&
      results[0].team1_id !== null &&
      results[0].team2_id !== null &&
      results[0].team1_score !== null &&
      results[0].team2_score !== null &&
      (results[0].team1_score !== 0 || results[0].team2_score !== 0)
    ) {
      throw new Error("CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES");
    }
  }

  if (nextLoserId) {
    const [results] = await connection.execute<
      (RowDataPacket & {
        team1_id: number | null;
        team2_id: number | null;
        team1_score: number | null;
        team2_score: number | null;
      })[]
    >(
      `SELECT team1_id, team2_id, team1_score, team2_score FROM bg_matches WHERE id = ? LIMIT 1`,
      [nextLoserId],
    );
    if (
      results.length > 0 &&
      results[0].team1_id !== null &&
      results[0].team2_id !== null &&
      results[0].team1_score !== null &&
      results[0].team2_score !== null &&
      (results[0].team1_score !== 0 || results[0].team2_score !== 0)
    ) {
      throw new Error("CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES");
    }
  }
}

export async function adminSaveMatchScores(
  connection: PoolConnection,
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
): Promise<void> {
  const [matches] = await connection.execute<MatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      next_winner_match_id,
      next_loser_match_id,
      winner_team_id
     FROM bg_matches
     WHERE id = ?
     LIMIT 1`,
    [matchId],
  );

  if (matches.length === 0) throw new Error("MATCH_NOT_FOUND");
  const match = matches[0];
  if (match.team1_id === null || match.team2_id === null) throw new Error("MATCH_NOT_READY");

  await checkDownstreamMatchesHaveNoScores(connection, match);

  if (forfeitTeamId !== undefined) {
    await connection.execute(
      `UPDATE bg_matches
       SET team1_score = NULL,
           team2_score = NULL,
           forfeit_team_id = ?
       WHERE id = ?`,
      [forfeitTeamId, matchId],
    );
  } else if (team1Score !== undefined && team2Score !== undefined) {
    await connection.execute(
      `UPDATE bg_matches
       SET team1_score = ?,
           team2_score = ?,
           forfeit_team_id = NULL
       WHERE id = ?`,
      [team1Score, team2Score, matchId],
    );
  } else {
    throw new Error("INVALID_REQUEST");
  }
}

export async function adminResolveMatch(
  connection: PoolConnection,
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
): Promise<void> {
  const [matches] = await connection.execute<MatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      next_winner_match_id,
      next_winner_slot,
      next_loser_match_id,
      next_loser_slot,
      winner_team_id
     FROM bg_matches
     WHERE id = ?
     LIMIT 1`,
    [matchId],
  );

  if (matches.length === 0) throw new Error("MATCH_NOT_FOUND");
  const match = matches[0];
  if (match.team1_id === null || match.team2_id === null) throw new Error("MATCH_NOT_READY");

  await checkDownstreamMatchesHaveNoScores(connection, match);

  const tournamentId = Number(match.tournament_id);

  let winnerTeamId: number | null;
  let loserTeamId: number | null;
  let resultTeam1Score: number | null;
  let resultTeam2Score: number | null;

  if (forfeitTeamId !== undefined) {
    winnerTeamId =
      forfeitTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);
    loserTeamId =
      forfeitTeamId === Number(match.team1_id) ? Number(match.team1_id) : Number(match.team2_id);
    resultTeam1Score = null;
    resultTeam2Score = null;
  } else if (team1Score !== undefined && team2Score !== undefined) {
    winnerTeamId = team1Score > team2Score ? Number(match.team1_id) : Number(match.team2_id);
    loserTeamId =
      winnerTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);
    resultTeam1Score = team1Score;
    resultTeam2Score = team2Score;
  } else {
    throw new Error("INVALID_REQUEST");
  }

  await finalizeMatch(connection, tournamentId, match, {
    team1Score: resultTeam1Score,
    team2Score: resultTeam2Score,
    winnerTeamId,
    loserTeamId,
  });

  if (forfeitTeamId !== undefined) {
    await connection.execute(
      `UPDATE bg_matches SET forfeit_team_id = ? WHERE id = ?`,
      [forfeitTeamId, matchId],
    );
  } else {
    await connection.execute(
      `UPDATE bg_matches SET forfeit_team_id = NULL WHERE id = ?`,
      [matchId],
    );
  }

  await tryAutoResolveByes(connection, tournamentId);
}
