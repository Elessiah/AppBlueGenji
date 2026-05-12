import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { MatchRow } from "./_internal";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { syncTournamentState } from "./state";
import { tryAutoResolveByes } from "./byes";

async function pushTeamToTarget(
  connection: PoolConnection,
  targetMatchId: number | null,
  targetSlot: number | null,
  teamId: number | null,
): Promise<void> {
  if (!targetMatchId || !targetSlot || !teamId) return;

  if (targetSlot === 1) {
    await connection.execute(`UPDATE bg_matches SET team1_id = ? WHERE id = ?`, [
      teamId,
      targetMatchId,
    ]);
  } else {
    await connection.execute(`UPDATE bg_matches SET team2_id = ? WHERE id = ?`, [
      teamId,
      targetMatchId,
    ]);
  }

  const [rows] = await connection.execute<
    (RowDataPacket & { team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT team1_id, team2_id FROM bg_matches WHERE id = ? LIMIT 1`,
    [targetMatchId],
  );

  const row = rows[0];
  const nextStatus =
    row.team1_id !== null && row.team2_id !== null ? "READY" : "PENDING";

  await connection.execute(`UPDATE bg_matches SET status = ? WHERE id = ?`, [
    nextStatus,
    targetMatchId,
  ]);
}

export async function finalizeMatch(
  connection: PoolConnection,
  tournamentId: number,
  match: Pick<
    MatchRow,
    | "id"
    | "team1_id"
    | "team2_id"
    | "next_winner_match_id"
    | "next_winner_slot"
    | "next_loser_match_id"
    | "next_loser_slot"
  >,
  result: {
    team1Score: number | null;
    team2Score: number | null;
    winnerTeamId: number | null;
    loserTeamId: number | null;
  },
): Promise<void> {
  await connection.execute(
    `UPDATE bg_matches
     SET team1_score = ?,
         team2_score = ?,
         winner_team_id = ?,
         loser_team_id = ?,
         status = 'COMPLETED',
         team1_report_score = NULL,
         team1_report_opponent_score = NULL,
         team1_reported_at = NULL,
         team2_report_score = NULL,
         team2_report_opponent_score = NULL,
         team2_reported_at = NULL,
         score_deadline_at = NULL
     WHERE id = ?`,
    [
      result.team1Score,
      result.team2Score,
      result.winnerTeamId,
      result.loserTeamId,
      match.id,
    ],
  );

  await pushTeamToTarget(
    connection,
    match.next_winner_match_id === null ? null : Number(match.next_winner_match_id),
    match.next_winner_slot === null ? null : Number(match.next_winner_slot),
    result.winnerTeamId,
  );

  await pushTeamToTarget(
    connection,
    match.next_loser_match_id === null ? null : Number(match.next_loser_match_id),
    match.next_loser_slot === null ? null : Number(match.next_loser_slot),
    result.loserTeamId,
  );
}

function validateScoreValue(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("INVALID_SCORE");
  }
  if (value < 0 || value > 99) {
    throw new Error("INVALID_SCORE_RANGE");
  }
  return Math.trunc(value);
}

export async function reportMatchScore(
  connection: PoolConnection,
  tournamentId: number,
  matchId: number,
  userId: number,
  myScoreRaw: number,
  opponentScoreRaw: number,
): Promise<string | null> {
  const myScore = validateScoreValue(myScoreRaw);
  const opponentScore = validateScoreValue(opponentScoreRaw);

  if (myScore === opponentScore) {
    throw new Error("DRAW_NOT_ALLOWED");
  }

  const activeTeam = await getUserActiveTeam(userId);
  if (!activeTeam) {
    throw new Error("NO_ACTIVE_TEAM");
  }

  const { row: tournament } = await syncTournamentState(connection, tournamentId);
  if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");

  const [matches] = await connection.execute<MatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      team1_report_score,
      team1_report_opponent_score,
      team1_reported_at,
      team2_report_score,
      team2_report_opponent_score,
      team2_reported_at,
      score_deadline_at,
      next_winner_match_id,
      next_winner_slot,
      next_loser_match_id,
      next_loser_slot,
      winner_team_id,
      status
     FROM bg_matches
     WHERE id = ?
       AND tournament_id = ?
     LIMIT 1`,
    [matchId, tournamentId],
  );

  if (matches.length === 0) throw new Error("MATCH_NOT_FOUND");
  const match = matches[0];

  if (match.winner_team_id !== null) {
    throw new Error("MATCH_ALREADY_COMPLETED");
  }

  if (match.team1_id === null || match.team2_id === null) {
    throw new Error("MATCH_NOT_READY");
  }

  const isTeam1Reporter = Number(match.team1_id) === activeTeam.teamId;
  const isTeam2Reporter = Number(match.team2_id) === activeTeam.teamId;

  if (!isTeam1Reporter && !isTeam2Reporter) {
    throw new Error("NOT_IN_MATCH");
  }

  if (isTeam1Reporter) {
    await connection.execute(
      `UPDATE bg_matches
       SET team1_report_score = ?,
           team1_report_opponent_score = ?,
           team1_reported_at = NOW(),
           score_deadline_at = COALESCE(score_deadline_at, DATE_ADD(NOW(), INTERVAL ? MINUTE)),
           status = 'AWAITING_CONFIRMATION'
       WHERE id = ?`,
      [myScore, opponentScore, SCORE_REPORT_TIMEOUT_MINUTES, matchId],
    );
  }

  if (isTeam2Reporter) {
    await connection.execute(
      `UPDATE bg_matches
       SET team2_report_score = ?,
           team2_report_opponent_score = ?,
           team2_reported_at = NOW(),
           score_deadline_at = COALESCE(score_deadline_at, DATE_ADD(NOW(), INTERVAL ? MINUTE)),
           status = 'AWAITING_CONFIRMATION'
       WHERE id = ?`,
      [myScore, opponentScore, SCORE_REPORT_TIMEOUT_MINUTES, matchId],
    );
  }

  const [updatedRows] = await connection.execute<MatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      team1_report_score,
      team1_report_opponent_score,
      team1_reported_at,
      team2_report_score,
      team2_report_opponent_score,
      team2_reported_at,
      score_deadline_at,
      next_winner_match_id,
      next_winner_slot,
      next_loser_match_id,
      next_loser_slot
    FROM bg_matches
    WHERE id = ?
    LIMIT 1`,
    [matchId],
  );

  const updated = updatedRows[0];
  let pendingBotLog: string | null = null;

  if (
    updated.team1_report_score !== null &&
    updated.team1_report_opponent_score !== null &&
    updated.team2_report_score !== null &&
    updated.team2_report_opponent_score !== null
  ) {
    const consistent =
      Number(updated.team1_report_score) === Number(updated.team2_report_opponent_score) &&
      Number(updated.team1_report_opponent_score) === Number(updated.team2_report_score);

    if (consistent) {
      const team1Score = Number(updated.team1_report_score);
      const team2Score = Number(updated.team1_report_opponent_score);
      const winnerTeamId = team1Score > team2Score ? Number(updated.team1_id) : Number(updated.team2_id);
      const loserTeamId =
        winnerTeamId === Number(updated.team1_id) ? Number(updated.team2_id) : Number(updated.team1_id);

      await finalizeMatch(connection, tournamentId, updated, {
        team1Score,
        team2Score,
        winnerTeamId,
        loserTeamId,
      });
    } else {
      await connection.execute(`UPDATE bg_matches SET status = 'AWAITING_CONFIRMATION' WHERE id = ?`, [
        matchId,
      ]);

      const [teamNames] = await connection.execute<
        (RowDataPacket & {
          team1_name: string;
          team2_name: string;
          tournament_name: string;
        })[]
      >(
        `SELECT
          t1.name AS team1_name,
          t2.name AS team2_name,
          tr.name AS tournament_name
         FROM bg_matches m
         JOIN bg_teams t1 ON t1.id = m.team1_id
         JOIN bg_teams t2 ON t2.id = m.team2_id
         JOIN bg_tournaments tr ON tr.id = m.tournament_id
         WHERE m.id = ?
         LIMIT 1`,
        [matchId],
      );

      if (teamNames.length > 0) {
        const info = teamNames[0];
        pendingBotLog = `[Score conflict] Tournoi "${info.tournament_name}" - Match #${matchId} : ${info.team1_name} vs ${info.team2_name}. Validation admin requise.`;
      }
    }
  }

  await tryAutoResolveByes(connection, tournamentId);

  return pendingBotLog;
}
