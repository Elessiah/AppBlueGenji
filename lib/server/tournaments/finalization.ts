import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { resetRegistrationRanks, finishTournament } from "./repository";

export async function finalizeTournamentIfDone(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  const [remaining] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c
     FROM bg_matches
     WHERE tournament_id = ?
       AND winner_team_id IS NULL
       AND (team1_id IS NOT NULL OR team2_id IS NOT NULL)`,
    [tournamentId],
  );

  if (Number(remaining[0]?.c ?? 0) > 0) {
    return;
  }

  const [allMatches] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches WHERE tournament_id = ?`,
    [tournamentId],
  );

  if (Number(allMatches[0]?.c ?? 0) === 0) {
    return;
  }

  await finishTournament(connection, tournamentId);
  await resetRegistrationRanks(connection, tournamentId);

  const [tournamentMetaRows] = await connection.execute<
    (RowDataPacket & { format: string; has_third_place_match: number })[]
  >(`SELECT format, has_third_place_match FROM bg_tournaments WHERE id = ? LIMIT 1`, [
    tournamentId,
  ]);
  const tournamentMeta = tournamentMetaRows[0];

  let fallbackStartRank = 3;

  if (tournamentMeta?.format === "DOUBLE") {
    const [grandFinalRows] = await connection.execute<
      (RowDataPacket & { winner_team_id: number | null; loser_team_id: number | null })[]
    >(
      `SELECT winner_team_id, loser_team_id
       FROM bg_matches
       WHERE tournament_id = ? AND bracket = 'GRAND' AND round_number = 1`,
      [tournamentId],
    );
    const grandFinal = grandFinalRows[0];
    if (grandFinal?.winner_team_id) {
      await connection.execute(
        `UPDATE bg_tournament_registrations SET final_rank = 1 WHERE tournament_id = ? AND team_id = ?`,
        [tournamentId, grandFinal.winner_team_id],
      );
    }
    if (grandFinal?.loser_team_id) {
      await connection.execute(
        `UPDATE bg_tournament_registrations SET final_rank = 2 WHERE tournament_id = ? AND team_id = ?`,
        [tournamentId, grandFinal.loser_team_id],
      );
    }
  } else {
    const [upperFinalRows] = await connection.execute<
      (RowDataPacket & { winner_team_id: number | null; loser_team_id: number | null })[]
    >(
      `SELECT winner_team_id, loser_team_id
       FROM bg_matches
       WHERE tournament_id = ? AND bracket = 'UPPER'
       ORDER BY round_number DESC
       LIMIT 1`,
      [tournamentId],
    );
    const upperFinal = upperFinalRows[0];
    if (upperFinal?.winner_team_id) {
      await connection.execute(
        `UPDATE bg_tournament_registrations SET final_rank = 1 WHERE tournament_id = ? AND team_id = ?`,
        [tournamentId, upperFinal.winner_team_id],
      );
    }
    if (upperFinal?.loser_team_id) {
      await connection.execute(
        `UPDATE bg_tournament_registrations SET final_rank = 2 WHERE tournament_id = ? AND team_id = ?`,
        [tournamentId, upperFinal.loser_team_id],
      );
    }

    if (tournamentMeta?.has_third_place_match) {
      const [thirdPlaceRows] = await connection.execute<
        (RowDataPacket & { winner_team_id: number | null; loser_team_id: number | null })[]
      >(
        `SELECT winner_team_id, loser_team_id
         FROM bg_matches
         WHERE tournament_id = ? AND bracket = 'THIRD_PLACE'
         LIMIT 1`,
        [tournamentId],
      );
      const thirdPlace = thirdPlaceRows[0];
      if (thirdPlace?.winner_team_id) {
        await connection.execute(
          `UPDATE bg_tournament_registrations SET final_rank = 3 WHERE tournament_id = ? AND team_id = ?`,
          [tournamentId, thirdPlace.winner_team_id],
        );
      }
      if (thirdPlace?.loser_team_id) {
        await connection.execute(
          `UPDATE bg_tournament_registrations SET final_rank = 4 WHERE tournament_id = ? AND team_id = ?`,
          [tournamentId, thirdPlace.loser_team_id],
        );
      }
      fallbackStartRank = 5;
    }
  }

  const [rankingRows] = await connection.execute<
    (RowDataPacket & {
      team_id: number;
      wins: number;
      losses: number;
      last_progress_at: Date | null;
    })[]
  >(
    `SELECT
      r.team_id,
      COALESCE(SUM(CASE WHEN m.winner_team_id = r.team_id THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN m.loser_team_id = r.team_id THEN 1 ELSE 0 END), 0) AS losses,
      MAX(CASE
        WHEN m.winner_team_id = r.team_id OR m.loser_team_id = r.team_id
          THEN m.updated_at
        ELSE NULL
      END) AS last_progress_at
     FROM bg_tournament_registrations r
     LEFT JOIN bg_matches m ON m.tournament_id = r.tournament_id
     WHERE r.tournament_id = ? AND r.final_rank IS NULL
     GROUP BY r.team_id
     ORDER BY wins DESC, losses ASC, last_progress_at DESC`,
    [tournamentId],
  );

  let rank = fallbackStartRank;
  for (const row of rankingRows) {
    await connection.execute(
      `UPDATE bg_tournament_registrations
       SET final_rank = ?
       WHERE tournament_id = ? AND team_id = ?`,
      [rank, tournamentId, Number(row.team_id)],
    );
    rank += 1;
  }
}

export async function resolveExpiredScoreReports(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  const [rows] = await connection.execute<MatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      team1_report_score,
      team1_report_opponent_score,
      team2_report_score,
      team2_report_opponent_score,
      next_winner_match_id,
      next_winner_slot,
      next_loser_match_id,
      next_loser_slot
     FROM bg_matches
     WHERE tournament_id = ?
       AND status = 'AWAITING_CONFIRMATION'
       AND score_deadline_at IS NOT NULL
       AND score_deadline_at <= NOW()
       AND winner_team_id IS NULL`,
    [tournamentId],
  );

  // Import at runtime to avoid circular deps
  const { finalizeMatch } = await import("./scoring");

  for (const match of rows) {
    if (match.team1_id === null || match.team2_id === null) {
      continue;
    }

    if (
      match.team1_report_score !== null &&
      match.team1_report_opponent_score !== null &&
      match.team2_report_score === null
    ) {
      const team1Score = Number(match.team1_report_score);
      const team2Score = Number(match.team1_report_opponent_score);
      const winnerTeamId = team1Score >= team2Score ? Number(match.team1_id) : Number(match.team2_id);
      const loserTeamId =
        winnerTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);

      await finalizeMatch(connection, tournamentId, match, {
        team1Score,
        team2Score,
        winnerTeamId,
        loserTeamId,
      });
    }

    if (
      match.team2_report_score !== null &&
      match.team2_report_opponent_score !== null &&
      match.team1_report_score === null
    ) {
      const team1Score = Number(match.team2_report_opponent_score);
      const team2Score = Number(match.team2_report_score);
      const winnerTeamId = team1Score >= team2Score ? Number(match.team1_id) : Number(match.team2_id);
      const loserTeamId =
        winnerTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);

      await finalizeMatch(connection, tournamentId, match, {
        team1Score,
        team2Score,
        winnerTeamId,
        loserTeamId,
      });
    }
  }
}

// Import MatchRow type
import type { MatchRow } from "./_internal";
