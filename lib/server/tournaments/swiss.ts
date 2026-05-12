import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pairFirstRound, pairNextRound, type Participant } from "@/lib/shared/swiss-pairing";
import { computeRecommendedRounds } from "@/lib/shared/swiss";
import { createMatch } from "./repository";

const POINTS_FOR_BYE = 3;

interface SwissStandingsRow extends RowDataPacket {
  team_id: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  byes: number;
  opponent_ids_json: string;
}

interface TournamentSwissRow extends RowDataPacket {
  format: string;
  swiss_total_rounds: number | null;
  swiss_current_round: number;
  swiss_points_win: number;
  swiss_points_draw: number;
  swiss_points_loss: number;
  swiss_points_bye: number;
}

export async function initializeSwissTournament(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const [tournamentRows] = await conn.execute<TournamentSwissRow[]>(
    `SELECT format, swiss_total_rounds, swiss_points_win, swiss_points_draw, swiss_points_loss, swiss_points_bye
     FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );

  if (tournamentRows.length === 0) {
    throw new Error("TOURNAMENT_NOT_FOUND");
  }

  const tournament = tournamentRows[0];
  if (tournament.format !== "SWISS") {
    return;
  }

  // Get registered teams
  const [registrations] = await conn.execute<RowDataPacket[]>(
    `SELECT team_id FROM bg_tournament_registrations WHERE tournament_id = ?`,
    [tournamentId],
  );

  const teamIds = registrations.map((r) => Number(r.team_id));

  // Compute total rounds if not already set
  let totalRounds = tournament.swiss_total_rounds;
  if (totalRounds === null) {
    totalRounds = computeRecommendedRounds(teamIds.length);
    await conn.execute(
      `UPDATE bg_tournaments SET swiss_total_rounds = ? WHERE id = ?`,
      [totalRounds, tournamentId],
    );
  }

  // Initialize bg_swiss_standings for each team
  for (const teamId of teamIds) {
    await conn.execute(
      `INSERT INTO bg_swiss_standings (tournament_id, team_id, points, wins, draws, losses, byes, opponent_ids_json)
       VALUES (?, ?, 0, 0, 0, 0, 0, '[]')
       ON DUPLICATE KEY UPDATE points = 0, wins = 0, draws = 0, losses = 0, byes = 0, opponent_ids_json = '[]'`,
      [tournamentId, teamId],
    );
  }
}

export async function generateFirstRound(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const [tournamentRows] = await conn.execute<TournamentSwissRow[]>(
    `SELECT format FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );

  if (tournamentRows.length === 0 || tournamentRows[0].format !== "SWISS") {
    return;
  }

  // Get current standings (should all be at 0 points)
  const [standings] = await conn.execute<SwissStandingsRow[]>(
    `SELECT team_id, points, opponent_ids_json FROM bg_swiss_standings
     WHERE tournament_id = ? ORDER BY team_id`,
    [tournamentId],
  );

  const participants: Participant[] = standings.map((row) => ({
    teamId: Number(row.team_id),
    points: Number(row.points),
    opponentIds: JSON.parse(row.opponent_ids_json),
    hasReceivedBye: false,
  }));

  // Pair teams for first round
  const pairings = pairFirstRound(participants);

  // Create matches
  let matchNumber = 1;
  for (const pairing of pairings) {
    const isBye = pairing.teamBId === null;

    const matchId = await createMatch(conn, tournamentId, "UPPER", 1, matchNumber);

    // Set participants and Swiss metadata
    await conn.execute(
      `UPDATE bg_matches SET
       team1_id = ?, team2_id = ?, swiss_round = ?, is_bye = ?,
       status = ?
       WHERE id = ?`,
      [
        pairing.teamAId,
        pairing.teamBId,
        1,
        isBye ? 1 : 0,
        isBye ? "COMPLETED" : "READY",
        matchId,
      ],
    );

    // If bye, immediately set score and winner
    if (isBye) {
      await conn.execute(
        `UPDATE bg_matches SET
         team1_score = ?, team2_score = 0, winner_team_id = ?
         WHERE id = ?`,
        [POINTS_FOR_BYE, pairing.teamAId, matchId],
      );

      // Update standings for bye
      await conn.execute(
        `UPDATE bg_swiss_standings SET byes = byes + 1, points = points + ?
         WHERE tournament_id = ? AND team_id = ?`,
        [POINTS_FOR_BYE, tournamentId, pairing.teamAId],
      );
    }

    matchNumber++;
  }

  // Update tournament current round
  await conn.execute(`UPDATE bg_tournaments SET swiss_current_round = 1 WHERE id = ?`, [
    tournamentId,
  ]);
}

export async function generateNextRound(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const [tournamentRows] = await conn.execute<TournamentSwissRow[]>(
    `SELECT format, swiss_current_round, swiss_total_rounds FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );

  if (tournamentRows.length === 0 || tournamentRows[0].format !== "SWISS") {
    return;
  }

  const tournament = tournamentRows[0];
  const currentRound = Number(tournament.swiss_current_round);
  const totalRounds = Number(tournament.swiss_total_rounds);

  // Verify all matches from current round are completed
  const [incompleteMatches] = await conn.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM bg_matches
     WHERE tournament_id = ? AND swiss_round = ? AND status != 'COMPLETED'`,
    [tournamentId, currentRound],
  );

  if (Number(incompleteMatches[0].count) > 0) {
    throw new Error("NOT_ALL_MATCHES_COMPLETED");
  }

  // If we've completed all rounds, mark tournament as finished
  if (currentRound >= totalRounds) {
    await conn.execute(`UPDATE bg_tournaments SET state = 'FINISHED' WHERE id = ?`, [
      tournamentId,
    ]);
    return;
  }

  // Load standings
  const [standings] = await conn.execute<SwissStandingsRow[]>(
    `SELECT team_id, points, opponent_ids_json, byes FROM bg_swiss_standings
     WHERE tournament_id = ? ORDER BY points DESC, team_id ASC`,
    [tournamentId],
  );

  const participants: Participant[] = standings.map((row) => ({
    teamId: Number(row.team_id),
    points: Number(row.points),
    opponentIds: JSON.parse(row.opponent_ids_json),
    hasReceivedBye: Number(row.byes) > 0,
  }));

  // Generate pairings
  const pairings = pairNextRound(participants);

  // Create matches for next round
  const nextRound = currentRound + 1;
  let matchNumber = 1;
  for (const pairing of pairings) {
    const isBye = pairing.teamBId === null;

    const matchId = await createMatch(conn, tournamentId, "UPPER", nextRound, matchNumber);

    // Set participants and Swiss metadata
    await conn.execute(
      `UPDATE bg_matches SET
       team1_id = ?, team2_id = ?, swiss_round = ?, is_bye = ?,
       status = ?
       WHERE id = ?`,
      [
        pairing.teamAId,
        pairing.teamBId,
        nextRound,
        isBye ? 1 : 0,
        isBye ? "COMPLETED" : "READY",
        matchId,
      ],
    );

    // If bye, immediately set score and winner
    if (isBye) {
      await conn.execute(
        `UPDATE bg_matches SET
         team1_score = ?, team2_score = 0, winner_team_id = ?
         WHERE id = ?`,
        [POINTS_FOR_BYE, pairing.teamAId, matchId],
      );

      // Update standings for bye
      await conn.execute(
        `UPDATE bg_swiss_standings SET byes = byes + 1, points = points + ?
         WHERE tournament_id = ? AND team_id = ?`,
        [POINTS_FOR_BYE, tournamentId, pairing.teamAId],
      );
    }

    matchNumber++;
  }

  // Update current round
  await conn.execute(`UPDATE bg_tournaments SET swiss_current_round = ? WHERE id = ?`, [
    nextRound,
    tournamentId,
  ]);
}

export async function applySwissMatchResult(
  matchId: number,
  conn: PoolConnection,
): Promise<void> {
  // Get match and tournament info
  const [matchRows] = await conn.execute<RowDataPacket[]>(
    `SELECT tournament_id, team1_id, team2_id, team1_score, team2_score, swiss_round, is_bye
     FROM bg_matches WHERE id = ? LIMIT 1`,
    [matchId],
  );

  if (matchRows.length === 0) {
    return;
  }

  const match = matchRows[0];
  const tournamentId = Number(match.tournament_id);
  const team1Id = Number(match.team1_id);
  const team2Id = match.team2_id ? Number(match.team2_id) : null;
  const team1Score = Number(match.team1_score);
  const team2Score = match.team2_score ? Number(match.team2_score) : 0;
  const swissRound = match.swiss_round ? Number(match.swiss_round) : null;
  const isBye = Boolean(match.is_bye);

  if (swissRound === null || isBye) {
    return;
  }

  // Get tournament settings
  const [tournamentRows] = await conn.execute<TournamentSwissRow[]>(
    `SELECT swiss_points_win, swiss_points_draw, swiss_points_loss
     FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );

  if (tournamentRows.length === 0) {
    return;
  }

  const tournament = tournamentRows[0];
  const pointsWin = Number(tournament.swiss_points_win);
  const pointsDraw = Number(tournament.swiss_points_draw);
  const pointsLoss = Number(tournament.swiss_points_loss);

  // Update standings based on match result
  if (team2Id !== null) {
    // Normal match
    let team1Points = 0;
    let team2Points = 0;
    let team1Wins = 0;
    let team1Losses = 0;
    let team2Wins = 0;
    let team2Losses = 0;

    if (team1Score > team2Score) {
      team1Points = pointsWin;
      team2Points = pointsLoss;
      team1Wins = 1;
      team2Losses = 1;
    } else if (team1Score < team2Score) {
      team1Points = pointsLoss;
      team2Points = pointsWin;
      team1Losses = 1;
      team2Wins = 1;
    } else {
      // Draw (if allowed)
      team1Points = pointsDraw;
      team2Points = pointsDraw;
    }

    // Update team1
    await conn.execute(
      `UPDATE bg_swiss_standings SET
       points = points + ?, wins = wins + ?, losses = losses + ?,
       opponent_ids_json = JSON_ARRAY_APPEND(opponent_ids_json, '$', ?)
       WHERE tournament_id = ? AND team_id = ?`,
      [team1Points, team1Wins, team1Losses, team2Id, tournamentId, team1Id],
    );

    // Update team2
    await conn.execute(
      `UPDATE bg_swiss_standings SET
       points = points + ?, wins = wins + ?, losses = losses + ?,
       opponent_ids_json = JSON_ARRAY_APPEND(opponent_ids_json, '$', ?)
       WHERE tournament_id = ? AND team_id = ?`,
      [team2Points, team2Wins, team2Losses, team1Id, tournamentId, team2Id],
    );
  }

  // Check if all matches of this round are completed
  const [incompleteMatches] = await conn.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM bg_matches
     WHERE tournament_id = ? AND swiss_round = ? AND status != 'COMPLETED'`,
    [tournamentId, swissRound],
  );

  if (Number(incompleteMatches[0].count) === 0) {
    // All matches completed, generate next round
    await generateNextRound(tournamentId, conn);
  }
}
