import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { MatchRow } from "./_internal";

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
    `SELECT team1_id, team2_id
     FROM bg_matches
     WHERE id = ?
     LIMIT 1`,
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

async function finalizeMatch(
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

export async function tryAutoResolveByes(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  let hasProgress = true;

  while (hasProgress) {
    hasProgress = false;

    // Cas 1 : exactement une équipe présente, le slot vide n'a plus de feeder en attente → BYE win
    const [candidates] = await connection.execute<MatchRow[]>(
      `SELECT
        id,
        team1_id,
        team2_id,
        next_winner_match_id,
        next_winner_slot,
        next_loser_match_id,
        next_loser_slot
      FROM bg_matches
      WHERE tournament_id = ?
        AND status <> 'COMPLETED'
        AND winner_team_id IS NULL
        AND ((team1_id IS NULL AND team2_id IS NOT NULL) OR (team1_id IS NOT NULL AND team2_id IS NULL))`,
      [tournamentId],
    );

    for (const candidate of candidates) {
      const missingSlot = candidate.team1_id === null ? 1 : 2;
      const [feeders] = await connection.execute<(RowDataPacket & { c: number })[]>(
        `SELECT COUNT(*) AS c
         FROM bg_matches
         WHERE tournament_id = ?
           AND status <> 'COMPLETED'
           AND (
             (next_winner_match_id = ? AND next_winner_slot = ?)
             OR
             (next_loser_match_id = ? AND next_loser_slot = ?)
           )`,
        [tournamentId, candidate.id, missingSlot, candidate.id, missingSlot],
      );

      if (Number(feeders[0]?.c ?? 0) > 0) {
        continue;
      }

      const winnerTeamId =
        candidate.team1_id === null ? Number(candidate.team2_id) : Number(candidate.team1_id);
      const score =
        candidate.team1_id === null ? { team1: 0, team2: 1 } : { team1: 1, team2: 0 };

      await finalizeMatch(connection, tournamentId, candidate, {
        team1Score: score.team1,
        team2Score: score.team2,
        winnerTeamId,
        loserTeamId: null,
      });

      hasProgress = true;
    }

    // Cas 2 : les deux slots sont vides (match fantôme)
    const [ghosts] = await connection.execute<MatchRow[]>(
      `SELECT id
       FROM bg_matches
       WHERE tournament_id = ?
         AND status <> 'COMPLETED'
         AND winner_team_id IS NULL
         AND team1_id IS NULL
         AND team2_id IS NULL`,
      [tournamentId],
    );

    for (const ghost of ghosts) {
      const [feeders] = await connection.execute<(RowDataPacket & { c: number })[]>(
        `SELECT COUNT(*) AS c
         FROM bg_matches
         WHERE tournament_id = ?
           AND status <> 'COMPLETED'
           AND (next_winner_match_id = ? OR next_loser_match_id = ?)`,
        [tournamentId, ghost.id, ghost.id],
      );

      if (Number(feeders[0]?.c ?? 0) > 0) {
        continue;
      }

      await connection.execute(
        `UPDATE bg_matches
         SET status = 'COMPLETED',
             team1_score = 0,
             team2_score = 0
         WHERE id = ?`,
        [ghost.id],
      );

      hasProgress = true;
    }
  }
}
