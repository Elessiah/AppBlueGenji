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
  opponent_ids_json: string | number[];
  buchholz?: number;
}

// `opponent_ids_json` est une colonne JSON : mysql2 la renvoie déjà désérialisée
// (tableau), mais un driver ou un dump peut la rendre sous forme de chaîne. On
// accepte les deux plutôt que de faire un JSON.parse aveugle (qui échouait sur
// le tableau, `String([])` valant "").
function parseOpponentIds(value: string | number[] | null): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(Number) : [];
    } catch {
      return [];
    }
  }
  return [];
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

interface PhaseSwissRow extends RowDataPacket {
  format: string;
  swiss_total_rounds: number | null;
  swiss_current_round?: number;
}

async function getSwissSettings(
  conn: PoolConnection,
  tournamentId: number,
  phaseId: number,
): Promise<{
  format: string;
  totalRounds: number | null;
  currentRound: number;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  pointsBye: number;
}> {
  if (phaseId !== 0) {
    const [phaseRows] = await conn.execute<PhaseSwissRow[]>(
      `SELECT format, swiss_total_rounds, swiss_current_round FROM bg_tournament_phases WHERE id = ? LIMIT 1`,
      [phaseId],
    );
    if (phaseRows.length === 0) {
      throw new Error("PHASE_NOT_FOUND");
    }
    const phase = phaseRows[0];

    const [tournamentRows] = await conn.execute<TournamentSwissRow[]>(
      `SELECT swiss_current_round, swiss_points_win, swiss_points_draw, swiss_points_loss, swiss_points_bye
       FROM bg_tournaments WHERE id = ? LIMIT 1`,
      [tournamentId],
    );
    if (tournamentRows.length === 0) {
      throw new Error("TOURNAMENT_NOT_FOUND");
    }
    const tournament = tournamentRows[0];

    return {
      format: phase.format,
      totalRounds: phase.swiss_total_rounds,
      // Le compteur de manches d'une phase vit sur la phase. Le lire sur le
      // tournoi (ou le figer à 0) rejouerait la ronde 1 indéfiniment et la phase
      // ne se terminerait jamais.
      currentRound: Number(phase.swiss_current_round ?? 0),
      pointsWin: Number(tournament.swiss_points_win),
      pointsDraw: Number(tournament.swiss_points_draw),
      pointsLoss: Number(tournament.swiss_points_loss),
      pointsBye: Number(tournament.swiss_points_bye),
    };
  }

  const [tournamentRows] = await conn.execute<TournamentSwissRow[]>(
    `SELECT format, swiss_total_rounds, swiss_current_round, swiss_points_win, swiss_points_draw, swiss_points_loss, swiss_points_bye
     FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );

  if (tournamentRows.length === 0) {
    throw new Error("TOURNAMENT_NOT_FOUND");
  }

  const tournament = tournamentRows[0];
  return {
    format: tournament.format,
    totalRounds: tournament.swiss_total_rounds,
    currentRound: Number(tournament.swiss_current_round),
    pointsWin: Number(tournament.swiss_points_win),
    pointsDraw: Number(tournament.swiss_points_draw),
    pointsLoss: Number(tournament.swiss_points_loss),
    pointsBye: Number(tournament.swiss_points_bye),
  };
}

/**
 * Table portant les compteurs de manches : le tournoi pour une ronde suisse
 * classique, la phase pour une ronde suisse jouée dans un tournoi multi-phases.
 */
function swissCounterScope(
  tournamentId: number,
  phaseId: number,
): { table: "bg_tournaments" | "bg_tournament_phases"; rowId: number } {
  return phaseId === 0
    ? { table: "bg_tournaments", rowId: tournamentId }
    : { table: "bg_tournament_phases", rowId: phaseId };
}

export async function initializeSwissTournament(
  tournamentId: number,
  conn: PoolConnection,
  phaseId = 0,
): Promise<void> {
  const settings = await getSwissSettings(conn, tournamentId, phaseId);

  if (settings.format !== "SWISS") {
    return;
  }

  // Get registered teams
  let teamIds: number[];
  if (phaseId !== 0) {
    const [phaseTeams] = await conn.execute<RowDataPacket[]>(
      `SELECT team_id FROM bg_tournament_phase_teams WHERE phase_id = ?`,
      [phaseId],
    );
    teamIds = phaseTeams.map((r) => Number(r.team_id));
  } else {
    const [registrations] = await conn.execute<RowDataPacket[]>(
      `SELECT team_id FROM bg_tournament_registrations WHERE tournament_id = ?`,
      [tournamentId],
    );
    teamIds = registrations.map((r) => Number(r.team_id));
  }

  // Compute total rounds if not already set
  let totalRounds = settings.totalRounds;
  if (totalRounds === null) {
    totalRounds = computeRecommendedRounds(teamIds.length);
    if (phaseId !== 0) {
      await conn.execute(
        `UPDATE bg_tournament_phases SET swiss_total_rounds = ? WHERE id = ?`,
        [totalRounds, phaseId],
      );
    } else {
      await conn.execute(
        `UPDATE bg_tournaments SET swiss_total_rounds = ? WHERE id = ?`,
        [totalRounds, tournamentId],
      );
    }
  }

  // Initialize bg_swiss_standings for each team
  for (const teamId of teamIds) {
    await conn.execute(
      `INSERT INTO bg_swiss_standings (tournament_id, team_id, phase_id, points, wins, draws, losses, byes, opponent_ids_json)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, '[]')
       ON DUPLICATE KEY UPDATE points = 0, wins = 0, draws = 0, losses = 0, byes = 0, opponent_ids_json = '[]'`,
      [tournamentId, teamId, phaseId],
    );
  }
}

export async function generateFirstRound(
  tournamentId: number,
  conn: PoolConnection,
  phaseId = 0,
): Promise<void> {
  const settings = await getSwissSettings(conn, tournamentId, phaseId);

  if (settings.format !== "SWISS") {
    return;
  }

  // Get current standings (should all be at 0 points)
  const [standings] = await conn.execute<SwissStandingsRow[]>(
    `SELECT team_id, points, opponent_ids_json FROM bg_swiss_standings
     WHERE tournament_id = ? AND phase_id = ? ORDER BY team_id`,
    [tournamentId, phaseId],
  );

  const participants: Participant[] = standings.map((row) => ({
    teamId: Number(row.team_id),
    points: Number(row.points),
    opponentIds: parseOpponentIds(row.opponent_ids_json),
    hasReceivedBye: false,
  }));

  // Pair teams for first round
  const pairings = pairFirstRound(participants);

  // Create matches
  let matchNumber = 1;
  for (const pairing of pairings) {
    const isBye = pairing.teamBId === null;

    const matchId = await createMatch(conn, tournamentId, "UPPER", 1, matchNumber, phaseId);

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
         WHERE tournament_id = ? AND phase_id = ? AND team_id = ?`,
        [POINTS_FOR_BYE, tournamentId, phaseId, pairing.teamAId],
      );
    }

    matchNumber++;
  }

  const counter = swissCounterScope(tournamentId, phaseId);
  await conn.execute(`UPDATE ${counter.table} SET swiss_current_round = 1 WHERE id = ?`, [
    counter.rowId,
  ]);
}

export async function generateNextRound(
  tournamentId: number,
  conn: PoolConnection,
  phaseId = 0,
): Promise<{ done: boolean }> {
  const settings = await getSwissSettings(conn, tournamentId, phaseId);

  if (settings.format !== "SWISS") {
    return { done: false };
  }

  const currentRound = settings.currentRound;
  const totalRounds = Number(settings.totalRounds);

  // Verify all matches from current round are completed
  const [incompleteMatches] = await conn.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM bg_matches
     WHERE tournament_id = ? AND phase_id = ? AND swiss_round = ? AND status != 'COMPLETED'`,
    [tournamentId, phaseId, currentRound],
  );

  if (Number(incompleteMatches[0].count) > 0) {
    throw new Error("NOT_ALL_MATCHES_COMPLETED");
  }

  // If we've completed all rounds, mark tournament as finished (only for plain SWISS)
  if (currentRound >= totalRounds) {
    if (phaseId === 0) {
      await conn.execute(`UPDATE bg_tournaments SET state = 'FINISHED' WHERE id = ?`, [
        tournamentId,
      ]);
    }
    return { done: true };
  }

  // Load standings
  const [standings] = await conn.execute<SwissStandingsRow[]>(
    `SELECT team_id, points, opponent_ids_json, byes FROM bg_swiss_standings
     WHERE tournament_id = ? AND phase_id = ? ORDER BY points DESC, team_id ASC`,
    [tournamentId, phaseId],
  );

  const participants: Participant[] = standings.map((row) => ({
    teamId: Number(row.team_id),
    points: Number(row.points),
    opponentIds: parseOpponentIds(row.opponent_ids_json),
    hasReceivedBye: Number(row.byes) > 0,
  }));

  // Generate pairings
  const pairings = pairNextRound(participants);

  // Create matches for next round
  const nextRound = currentRound + 1;
  let matchNumber = 1;
  for (const pairing of pairings) {
    const isBye = pairing.teamBId === null;

    const matchId = await createMatch(conn, tournamentId, "UPPER", nextRound, matchNumber, phaseId);

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
         WHERE tournament_id = ? AND phase_id = ? AND team_id = ?`,
        [POINTS_FOR_BYE, tournamentId, phaseId, pairing.teamAId],
      );
    }

    matchNumber++;
  }

  const counter = swissCounterScope(tournamentId, phaseId);
  await conn.execute(`UPDATE ${counter.table} SET swiss_current_round = ? WHERE id = ?`, [
    nextRound,
    counter.rowId,
  ]);

  return { done: false };
}

export async function applySwissMatchResult(
  matchId: number,
  conn: PoolConnection,
): Promise<void> {
  // Get match and tournament info
  const [matchRows] = await conn.execute<RowDataPacket[]>(
    `SELECT tournament_id, team1_id, team2_id, team1_score, team2_score, swiss_round, is_bye, phase_id
     FROM bg_matches WHERE id = ? LIMIT 1`,
    [matchId],
  );

  if (matchRows.length === 0) {
    return;
  }

  const match = matchRows[0];
  const tournamentId = Number(match.tournament_id);
  const phaseId = Number(match.phase_id ?? 0);
  const team1Id = Number(match.team1_id);
  const team2Id = match.team2_id ? Number(match.team2_id) : null;
  const team1Score = Number(match.team1_score);
  const team2Score = match.team2_score ? Number(match.team2_score) : 0;
  const swissRound = match.swiss_round ? Number(match.swiss_round) : null;
  const isBye = Boolean(match.is_bye);

  if (swissRound === null || isBye) {
    return;
  }

  // Verify format is SWISS
  if (phaseId !== 0) {
    const [phaseRows] = await conn.execute<RowDataPacket[]>(
      `SELECT format FROM bg_tournament_phases WHERE id = ? LIMIT 1`,
      [phaseId],
    );
    if (phaseRows.length === 0 || phaseRows[0].format !== "SWISS") {
      return;
    }
  } else {
    const [tournamentRows] = await conn.execute<TournamentSwissRow[]>(
      `SELECT format FROM bg_tournaments WHERE id = ? LIMIT 1`,
      [tournamentId],
    );
    if (tournamentRows.length === 0 || tournamentRows[0].format !== "SWISS") {
      return;
    }
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
       WHERE tournament_id = ? AND phase_id = ? AND team_id = ?`,
      [team1Points, team1Wins, team1Losses, team2Id, tournamentId, phaseId, team1Id],
    );

    // Update team2
    await conn.execute(
      `UPDATE bg_swiss_standings SET
       points = points + ?, wins = wins + ?, losses = losses + ?,
       opponent_ids_json = JSON_ARRAY_APPEND(opponent_ids_json, '$', ?)
       WHERE tournament_id = ? AND phase_id = ? AND team_id = ?`,
      [team2Points, team2Wins, team2Losses, team1Id, tournamentId, phaseId, team2Id],
    );
  }

  // Check if all matches of this round are completed
  const [incompleteMatches] = await conn.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM bg_matches
     WHERE tournament_id = ? AND phase_id = ? AND swiss_round = ? AND status != 'COMPLETED'`,
    [tournamentId, phaseId, swissRound],
  );

  if (Number(incompleteMatches[0].count) === 0) {
    // All matches completed, generate next round
    await generateNextRound(tournamentId, conn, phaseId);
  }
}

export async function loadSwissRanking(
  conn: PoolConnection,
  tournamentId: number,
  phaseId = 0,
): Promise<number[]> {
  // Load all standings with their wins
  const [standings] = await conn.execute<SwissStandingsRow[]>(
    `SELECT team_id, points, wins, opponent_ids_json, losses FROM bg_swiss_standings
     WHERE tournament_id = ? AND phase_id = ?
     ORDER BY points DESC, wins DESC, losses ASC, team_id ASC`,
    [tournamentId, phaseId],
  );

  if (standings.length === 0) {
    return [];
  }

  // Build a map of team_id -> wins for buchholz calculation
  const winsMap = new Map<number, number>();
  for (const standing of standings) {
    winsMap.set(Number(standing.team_id), Number(standing.wins));
  }

  // Calculate buchholz for each team and sort
  const withBuchholz = standings.map((standing) => {
    const teamId = Number(standing.team_id);
    const opponentIds = parseOpponentIds(standing.opponent_ids_json);
    const buchholz = opponentIds.reduce((sum, oppId) => sum + (winsMap.get(oppId) ?? 0), 0);

    return {
      teamId,
      points: Number(standing.points),
      wins: Number(standing.wins),
      buchholz,
      losses: Number(standing.losses),
    };
  });

  // Sort by points DESC, wins DESC, buchholz DESC, losses ASC, team_id ASC
  withBuchholz.sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.buchholz !== b.buchholz) return b.buchholz - a.buchholz;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.teamId - b.teamId;
  });

  return withBuchholz.map((item) => item.teamId);
}
