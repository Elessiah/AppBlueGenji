
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { getDatabase } from "@/lib/server/database";
import { publishTournamentEvent } from "@/lib/server/live";
import {
  generateSeedOrder,
  nextPowerOfTwo,
  toIso,
} from "@/lib/server/serialization";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { sendBotLog } from "@/lib/server/bot-integration";
import type {
  BracketMatch,
  TournamentBuckets,
  TournamentCard,
  TournamentDetail,
  TournamentFormat,
  TournamentState,
} from "@/lib/shared/types";

type TournamentRow = RowDataPacket & {
  id: number;
  name: string;
  description: string | null;
  format: TournamentFormat;
  max_teams: number;
  state: TournamentState;
  start_visibility_at: Date;
  registration_open_at: Date;
  registration_close_at: Date;
  start_at: Date;
  bracket_size: number | null;
  created_at: Date;
  organizer_user_id: number;
  finished_at: Date | null;
  has_third_place_match: number;
};

type RegistrationRow = RowDataPacket & {
  team_id: number;
  team_name: string;
  logo_url: string | null;
  seed: number | null;
  final_rank: number | null;
  registered_at: Date;
};

type MatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  bracket: "UPPER" | "LOWER" | "GRAND" | "THIRD_PLACE";
  round_number: number;
  match_number: number;
  status: "PENDING" | "READY" | "AWAITING_CONFIRMATION" | "COMPLETED";
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
  team1_placeholder: string | null;
  team2_placeholder: string | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team_id: number | null;
  loser_team_id: number | null;
  forfeit_team_id: number | null;
  next_winner_match_id: number | null;
  next_winner_slot: number | null;
  next_loser_match_id: number | null;
  next_loser_slot: number | null;
  team1_report_score: number | null;
  team1_report_opponent_score: number | null;
  team1_reported_at: Date | null;
  team2_report_score: number | null;
  team2_report_opponent_score: number | null;
  team2_reported_at: Date | null;
  score_deadline_at: Date | null;
  updated_at: Date;
};

type TournamentListRow = TournamentRow & {
  registered_teams: number;
};

function computeTournamentState(row: Pick<TournamentRow, "state" | "finished_at" | "registration_open_at" | "registration_close_at" | "start_at">): TournamentState {
  if (row.state === "FINISHED" || row.finished_at) {
    return "FINISHED";
  }

  const now = Date.now();
  const openAt = new Date(row.registration_open_at).getTime();
  const closeAt = new Date(row.registration_close_at).getTime();
  const startAt = new Date(row.start_at).getTime();

  if (now < openAt) return "UPCOMING";
  if (now >= openAt && now <= closeAt) return "REGISTRATION";
  if (now >= startAt) return "RUNNING";
  return "UPCOMING";
}

function statusFromTeams(team1Id: number | null, team2Id: number | null): "PENDING" | "READY" {
  return team1Id !== null && team2Id !== null ? "READY" : "PENDING";
}

function mapCard(row: TournamentListRow): TournamentCard {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    format: row.format,
    maxTeams: Number(row.max_teams),
    registeredTeams: Number(row.registered_teams),
    state: row.state,
    startVisibilityAt: row.start_visibility_at.toISOString(),
    registrationOpenAt: row.registration_open_at.toISOString(),
    registrationCloseAt: row.registration_close_at.toISOString(),
    startAt: row.start_at.toISOString(),
    hasThirdPlaceMatch: Boolean(row.has_third_place_match),
  };
}

function mapMatch(row: MatchRow): BracketMatch {
  return {
    id: Number(row.id),
    tournamentId: Number(row.tournament_id),
    bracket: row.bracket,
    roundNumber: Number(row.round_number),
    matchNumber: Number(row.match_number),
    status: row.status,
    team1Id: row.team1_id === null ? null : Number(row.team1_id),
    team2Id: row.team2_id === null ? null : Number(row.team2_id),
    team1Name: row.team1_name,
    team2Name: row.team2_name,
    team1Placeholder: row.team1_placeholder ?? null,
    team2Placeholder: row.team2_placeholder ?? null,
    team1Score: row.team1_score === null ? null : Number(row.team1_score),
    team2Score: row.team2_score === null ? null : Number(row.team2_score),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    loserTeamId: row.loser_team_id === null ? null : Number(row.loser_team_id),
    forfeitTeamId: row.forfeit_team_id === null ? null : Number(row.forfeit_team_id),
    nextWinnerMatchId: row.next_winner_match_id === null ? null : Number(row.next_winner_match_id),
    nextWinnerSlot: row.next_winner_slot === null ? null : Number(row.next_winner_slot),
    nextLoserMatchId: row.next_loser_match_id === null ? null : Number(row.next_loser_match_id),
    nextLoserSlot: row.next_loser_slot === null ? null : Number(row.next_loser_slot),
    scoreDeadlineAt: toIso(row.score_deadline_at),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadTournamentRow(connection: PoolConnection, tournamentId: number): Promise<TournamentRow | null> {
  const [rows] = await connection.execute<TournamentRow[]>(
    `SELECT
      id,
      organizer_user_id,
      name,
      description,
      format,
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

async function loadRegisteredTeamIds(connection: PoolConnection, tournamentId: number): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { team_id: number; seed: number | null; registered_at: Date })[]>(
    `SELECT team_id, seed, registered_at
     FROM bg_tournament_registrations
     WHERE tournament_id = ?
     ORDER BY COALESCE(seed, 1000000), registered_at ASC`,
    [tournamentId],
  );

  return rows.map((row) => Number(row.team_id));
}

async function createMatch(
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

async function linkMatchWinner(
  connection: PoolConnection,
  matchId: number,
  targetMatchId: number,
  targetSlot: number,
): Promise<void> {
  await connection.execute(
    `UPDATE bg_matches
     SET next_winner_match_id = ?,
         next_winner_slot = ?
     WHERE id = ?`,
    [targetMatchId, targetSlot, matchId],
  );
}

async function linkMatchLoser(
  connection: PoolConnection,
  matchId: number,
  targetMatchId: number,
  targetSlot: number,
): Promise<void> {
  await connection.execute(
    `UPDATE bg_matches
     SET next_loser_match_id = ?,
         next_loser_slot = ?
     WHERE id = ?`,
    [targetMatchId, targetSlot, matchId],
  );
}

async function linkMatchLoserWithPlaceholder(
  connection: PoolConnection,
  sourceMatchId: number,
  targetMatchId: number,
  targetSlot: number,
  sourceRound: number,
  sourceMatchNumber: number,
): Promise<void> {
  // Link the loser connection
  await linkMatchLoser(connection, sourceMatchId, targetMatchId, targetSlot);

  // Set placeholder text for the target match slot
  const placeholderText = `Perdant match ${sourceMatchNumber} du upper R${sourceRound}`;
  if (targetSlot === 1) {
    await connection.execute(
      `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`,
      [placeholderText, targetMatchId],
    );
  } else {
    await connection.execute(
      `UPDATE bg_matches SET team2_placeholder = ? WHERE id = ?`,
      [placeholderText, targetMatchId],
    );
  }
}

async function setMatchParticipants(
  connection: PoolConnection,
  matchId: number,
  team1Id: number | null,
  team2Id: number | null,
): Promise<void> {
  await connection.execute(
    `UPDATE bg_matches
     SET team1_id = ?,
         team2_id = ?,
         status = ?
     WHERE id = ?`,
    [team1Id, team2Id, statusFromTeams(team1Id, team2Id), matchId],
  );
}

async function pushTeamToTarget(
  connection: PoolConnection,
  targetMatchId: number | null,
  targetSlot: number | null,
  teamId: number | null,
): Promise<void> {
  if (!targetMatchId || !targetSlot || !teamId) return;

  if (targetSlot === 1) {
    await connection.execute(`UPDATE bg_matches SET team1_id = ? WHERE id = ?`, [teamId, targetMatchId]);
  } else {
    await connection.execute(`UPDATE bg_matches SET team2_id = ? WHERE id = ?`, [teamId, targetMatchId]);
  }

  const [rows] = await connection.execute<(RowDataPacket & { team1_id: number | null; team2_id: number | null })[]>(
    `SELECT team1_id, team2_id
     FROM bg_matches
     WHERE id = ?
     LIMIT 1`,
    [targetMatchId],
  );

  const row = rows[0];
  const nextStatus = statusFromTeams(row.team1_id === null ? null : Number(row.team1_id), row.team2_id === null ? null : Number(row.team2_id));

  await connection.execute(`UPDATE bg_matches SET status = ? WHERE id = ?`, [nextStatus, targetMatchId]);
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
    [result.team1Score, result.team2Score, result.winnerTeamId, result.loserTeamId, match.id],
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
async function tryAutoResolveByes(connection: PoolConnection, tournamentId: number): Promise<void> {
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

      const winnerTeamId = candidate.team1_id === null ? Number(candidate.team2_id) : Number(candidate.team1_id);
      const score = candidate.team1_id === null ? { team1: 0, team2: 1 } : { team1: 1, team2: 0 };

      await finalizeMatch(
        connection,
        tournamentId,
        candidate,
        {
          team1Score: score.team1,
          team2Score: score.team2,
          winnerTeamId,
          loserTeamId: null,
        },
      );

      hasProgress = true;
    }

    // Cas 2 : les deux slots sont vides (match fantôme — p.ex. deux BYEs consécutifs en upper R1
    // qui ont chacun envoyé un perdant null vers le même match du lower bracket).
    // Si aucun feeder non-complété ne peut encore alimenter ce match, on le marque COMPLETED
    // sans gagnant pour débloquer les rounds suivants.
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

      // Aucune équipe ne peut plus arriver : match fantôme, on clôture sans vainqueur
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

async function finalizeTournamentIfDone(connection: PoolConnection, tournamentId: number): Promise<void> {
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

  await connection.execute(
    `UPDATE bg_tournaments
     SET state = 'FINISHED', finished_at = NOW()
     WHERE id = ?`,
    [tournamentId],
  );

  // Reset all ranks to recalculate them properly
  await connection.execute(
    `UPDATE bg_tournament_registrations
     SET final_rank = NULL
     WHERE tournament_id = ?`,
    [tournamentId],
  );

  // Query tournament format and third place setting
  const [tournamentMetaRows] = await connection.execute<(RowDataPacket & { format: string; has_third_place_match: number })[]>(
    `SELECT format, has_third_place_match FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  const tournamentMeta = tournamentMetaRows[0];

  let fallbackStartRank = 3;

  if (tournamentMeta?.format === "DOUBLE") {
    // Double elimination: rank 1 and 2 from grand final
    const [grandFinalRows] = await connection.execute<(RowDataPacket & { winner_team_id: number | null; loser_team_id: number | null })[]>(
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
    // Single elimination: rank 1 and 2 from the upper bracket final (last round)
    const [upperFinalRows] = await connection.execute<(RowDataPacket & { winner_team_id: number | null; loser_team_id: number | null })[]>(
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

    // Third place match
    if (tournamentMeta?.has_third_place_match) {
      const [thirdPlaceRows] = await connection.execute<(RowDataPacket & { winner_team_id: number | null; loser_team_id: number | null })[]>(
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

  // For other teams, rank by wins/losses
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

  publishTournamentEvent({
    type: "updated",
    tournamentId,
    emittedAt: new Date().toISOString(),
  });
}

async function resolveExpiredScoreReports(connection: PoolConnection, tournamentId: number): Promise<void> {
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

  for (const match of rows) {
    if (match.team1_id === null || match.team2_id === null) {
      continue;
    }

    if (match.team1_report_score !== null && match.team1_report_opponent_score !== null && match.team2_report_score === null) {
      const team1Score = Number(match.team1_report_score);
      const team2Score = Number(match.team1_report_opponent_score);
      const winnerTeamId = team1Score >= team2Score ? Number(match.team1_id) : Number(match.team2_id);
      const loserTeamId = winnerTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);

      await finalizeMatch(connection, tournamentId, match, {
        team1Score,
        team2Score,
        winnerTeamId,
        loserTeamId,
      });

      // Ranks are computed at tournament finalization, not progressively
    }

    if (match.team2_report_score !== null && match.team2_report_opponent_score !== null && match.team1_report_score === null) {
      const team1Score = Number(match.team2_report_opponent_score);
      const team2Score = Number(match.team2_report_score);
      const winnerTeamId = team1Score >= team2Score ? Number(match.team1_id) : Number(match.team2_id);
      const loserTeamId = winnerTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);

      await finalizeMatch(connection, tournamentId, match, {
        team1Score,
        team2Score,
        winnerTeamId,
        loserTeamId,
      });

      // Ranks are computed at tournament finalization, not progressively
    }
  }
}

async function createBracketIfMissing(connection: PoolConnection, tournament: TournamentRow): Promise<void> {
  const registeredTeamIds = await loadRegisteredTeamIds(connection, tournament.id);
  const expectedBracketSize = nextPowerOfTwo(registeredTeamIds.length);

  const [existingMatches] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches WHERE tournament_id = ?`,
    [tournament.id],
  );

  const hasExistingMatches = Number(existingMatches[0]?.c ?? 0) > 0;
  const bracketSizeChanged = tournament.bracket_size !== expectedBracketSize;

  if (hasExistingMatches && !bracketSizeChanged) {
    return;
  }

  if (hasExistingMatches && bracketSizeChanged) {
    await connection.execute(`DELETE FROM bg_matches WHERE tournament_id = ?`, [tournament.id]);
  }

  if (registeredTeamIds.length <= 1) {
    if (registeredTeamIds.length === 1) {
      await connection.execute(
        `UPDATE bg_tournament_registrations
         SET final_rank = 1
         WHERE tournament_id = ? AND team_id = ?`,
        [tournament.id, registeredTeamIds[0]],
      );
    }

    await connection.execute(
      `UPDATE bg_tournaments
       SET state = 'FINISHED', finished_at = NOW(), bracket_size = ?
       WHERE id = ?`,
      [registeredTeamIds.length, tournament.id],
    );

    return;
  }

  const bracketSize = expectedBracketSize;
  const rounds = Math.ceil(Math.log2(bracketSize));
  const upper: number[][] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const matchesCount = bracketSize / 2 ** round;
    upper[round] = [];
    for (let matchNumber = 1; matchNumber <= matchesCount; matchNumber += 1) {
      const id = await createMatch(connection, tournament.id, "UPPER", round, matchNumber);
      upper[round].push(id);
    }
  }

  const lower: number[][] = [];
  let grandFinalMatchId: number | null = null;

  if (tournament.format === "DOUBLE" && rounds >= 2) {
    // Double élimination : le lower bracket a 2*(rounds-1) rounds.
    //
    // Règle des match counts par round :
    //   LR1 = LR2 = bracketSize/4
    //   LR3 = LR4 = bracketSize/8
    //   LR2k-1 = LR2k = bracketSize / 2^(k+1)
    // Formule : matchCount(lbRound) = 2^( rounds - 2 - floor((lbRound-1)/2) )
    //
    // Alimentation depuis le upper bracket :
    //   UB R1 → LR1 (pairage 2:1, slots 1 et 2)
    //   UB Rk (k≥2) → LR(2*(k-1)) slot 2 (1:1, même index)
    //
    // Progression interne au lower bracket :
    //   Rounds impairs → suivant pair  : 1:1 (winner → slot 1 du même index)
    //   Rounds pairs   → suivant impair : 2:1 (pairage, deux winners → un match)

    const lowerRoundsCount = 2 * (rounds - 1);

    for (let lbRound = 1; lbRound <= lowerRoundsCount; lbRound += 1) {
      const matchCount = Math.round(Math.pow(2, rounds - 2 - Math.floor((lbRound - 1) / 2)));

      lower[lbRound] = [];
      for (let matchNumber = 1; matchNumber <= matchCount; matchNumber += 1) {
        const id = await createMatch(connection, tournament.id, "LOWER", lbRound, matchNumber);
        lower[lbRound].push(id);
      }
    }

    grandFinalMatchId = await createMatch(connection, tournament.id, "GRAND", 1, 1);
  }

  for (let round = 1; round <= rounds; round += 1) {
    for (let matchIndex = 0; matchIndex < upper[round].length; matchIndex += 1) {
      const source = upper[round][matchIndex];

      if (round < rounds) {
        const target = upper[round + 1][Math.floor(matchIndex / 2)];
        const slot = matchIndex % 2 === 0 ? 1 : 2;
        await linkMatchWinner(connection, source, target, slot);
      } else if (grandFinalMatchId) {
        await linkMatchWinner(connection, source, grandFinalMatchId, 1);
        await connection.execute(
          `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`,
          [`Gagnant du upper bracket`, grandFinalMatchId],
        );
      }

      if (tournament.format !== "DOUBLE" || rounds < 2 || !grandFinalMatchId) {
        continue;
      }

      // Liaison perdant upper → lower bracket
      if (round === 1) {
        // UB R1 : pairage 2:1 → LR1 (slots 1 et 2)
        const target = lower[1][Math.floor(matchIndex / 2)];
        const slot = matchIndex % 2 === 0 ? 1 : 2;
        await linkMatchLoserWithPlaceholder(connection, source, target, slot, round, matchIndex + 1);
      } else {
        // UB Rk (k≥2) : 1:1 → LR(2*(round-1)) slot 2
        const lbTargetRound = 2 * (round - 1);
        const target = lower[lbTargetRound]?.[matchIndex];
        if (target) {
          await linkMatchLoserWithPlaceholder(connection, source, target, 2, round, matchIndex + 1);
        }
      }
    }
  }

  // Petite finale (3ème place) pour simple élimination
  if (tournament.format === "SINGLE" && tournament.has_third_place_match && rounds >= 2) {
    const thirdPlaceId = await createMatch(connection, tournament.id, "THIRD_PLACE", 1, 1);
    const semis = upper[rounds - 1]; // 2 demi-finales
    for (let i = 0; i < semis.length; i += 1) {
      const slot = (i + 1) as 1 | 2;
      await linkMatchLoser(connection, semis[i], thirdPlaceId, slot);
      const placeholder = `Perdant demi-finale ${slot}`;
      await connection.execute(
        slot === 1
          ? `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`
          : `UPDATE bg_matches SET team2_placeholder = ? WHERE id = ?`,
        [placeholder, thirdPlaceId],
      );
    }
  }

  if (tournament.format === "DOUBLE" && rounds >= 2) {
    const lowerRoundsCount = 2 * (rounds - 1);

    for (let lbRound = 1; lbRound < lowerRoundsCount; lbRound += 1) {
      for (let matchIndex = 0; matchIndex < lower[lbRound].length; matchIndex += 1) {
        const source = lower[lbRound][matchIndex];
        const placeholder = `Gagnant match ${matchIndex + 1} du lower R${lbRound}`;

        if (lbRound % 2 === 1) {
          // Round impair : 1:1 → slot 1 du même index dans le round suivant
          const target = lower[lbRound + 1]?.[matchIndex];
          if (target) {
            await linkMatchWinner(connection, source, target, 1);
            await connection.execute(
              `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`,
              [placeholder, target],
            );
          }
        } else {
          // Round pair : 2:1, pairage des gagnants dans le round suivant
          const targetIdx = Math.floor(matchIndex / 2);
          const slot = matchIndex % 2 === 0 ? 1 : 2;
          const target = lower[lbRound + 1]?.[targetIdx];
          if (target) {
            await linkMatchWinner(connection, source, target, slot);
            if (slot === 1) {
              await connection.execute(
                `UPDATE bg_matches SET team1_placeholder = ? WHERE id = ?`,
                [placeholder, target],
              );
            } else {
              await connection.execute(
                `UPDATE bg_matches SET team2_placeholder = ? WHERE id = ?`,
                [placeholder, target],
              );
            }
          }
        }
      }
    }

    // Dernier round du lower bracket → Grande Finale slot 2
    if (lower[lowerRoundsCount]?.length > 0 && grandFinalMatchId) {
      await linkMatchWinner(connection, lower[lowerRoundsCount][0], grandFinalMatchId, 2);
      await connection.execute(
        `UPDATE bg_matches SET team2_placeholder = ? WHERE id = ?`,
        [`Gagnant du lower bracket`, grandFinalMatchId],
      );
    }
  }

  const seedOrder = generateSeedOrder(bracketSize);
  const seedToPosition = new Map<number, number>();
  seedOrder.forEach((seed, index) => seedToPosition.set(seed, index));

  const slots = new Array<number | null>(bracketSize).fill(null);
  for (let i = 0; i < registeredTeamIds.length; i += 1) {
    const seed = i + 1;
    const position = seedToPosition.get(seed);
    if (position !== undefined) {
      slots[position] = registeredTeamIds[i];
    }
  }

  for (let matchIndex = 0; matchIndex < upper[1].length; matchIndex += 1) {
    const team1Id = slots[matchIndex * 2] ?? null;
    const team2Id = slots[matchIndex * 2 + 1] ?? null;
    await setMatchParticipants(connection, upper[1][matchIndex], team1Id, team2Id);
  }

  await connection.execute(`UPDATE bg_tournaments SET bracket_size = ? WHERE id = ?`, [bracketSize, tournament.id]);

  await tryAutoResolveByes(connection, tournament.id);
}

async function syncTournamentState(
  connection: PoolConnection,
  tournamentId: number,
): Promise<{ row: TournamentRow | null; stateChanged: boolean }> {
  const tournament = await loadTournamentRow(connection, tournamentId);
  if (!tournament) return { row: null, stateChanged: false };

  const computed = computeTournamentState(tournament);
  let stateChanged = false;

  if (computed !== tournament.state) {
    await connection.execute(`UPDATE bg_tournaments SET state = ? WHERE id = ?`, [computed, tournamentId]);
    tournament.state = computed;
    stateChanged = true;
  }

  if (tournament.state === "RUNNING") {
    await createBracketIfMissing(connection, tournament);
    await resolveExpiredScoreReports(connection, tournamentId);
    await tryAutoResolveByes(connection, tournamentId);
    await finalizeTournamentIfDone(connection, tournamentId);

    const refreshed = await loadTournamentRow(connection, tournamentId);
    return { row: refreshed, stateChanged };
  }

  return { row: tournament, stateChanged };
}

async function syncVisibleTournaments(): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  const changedIds: number[] = [];

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_tournaments WHERE state <> 'FINISHED'`,
    );

    for (const row of rows) {
      const { stateChanged } = await syncTournamentState(connection, Number(row.id));
      if (stateChanged) changedIds.push(Number(row.id));
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  for (const id of changedIds) {
    publishTournamentEvent({ type: "updated", tournamentId: id, emittedAt: new Date().toISOString() });
  }
}

export async function createTournament(
  organizerUserId: number,
  payload: {
    name: string;
    description: string | null;
    format: TournamentFormat;
    maxTeams: number;
    startVisibilityAt: string;
    registrationOpenAt: string;
    registrationCloseAt: string;
    startAt: string;
    hasThirdPlaceMatch?: boolean;
  },
): Promise<number> {
  const db = await getDatabase();

  const startVisibilityAt = new Date(payload.startVisibilityAt);
  const registrationOpenAt = new Date(payload.registrationOpenAt);
  const registrationCloseAt = new Date(payload.registrationCloseAt);
  const startAt = new Date(payload.startAt);

  if (
    Number.isNaN(startVisibilityAt.getTime())
    || Number.isNaN(registrationOpenAt.getTime())
    || Number.isNaN(registrationCloseAt.getTime())
    || Number.isNaN(startAt.getTime())
  ) {
    throw new Error("INVALID_DATES");
  }

  if (!(startVisibilityAt <= registrationOpenAt && registrationOpenAt <= registrationCloseAt && registrationCloseAt <= startAt)) {
    throw new Error("INVALID_DATE_ORDER");
  }

  const temporaryState: TournamentState = computeTournamentState({
    state: "UPCOMING",
    finished_at: null,
    registration_open_at: registrationOpenAt,
    registration_close_at: registrationCloseAt,
    start_at: startAt,
  });

  const hasThirdPlaceMatch = payload.format === "SINGLE" && Boolean(payload.hasThirdPlaceMatch);

  const [insert] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments (
      organizer_user_id,
      name,
      description,
      format,
      max_teams,
      state,
      start_visibility_at,
      registration_open_at,
      registration_close_at,
      start_at,
      has_third_place_match
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      organizerUserId,
      payload.name.trim(),
      payload.description,
      payload.format,
      payload.maxTeams,
      temporaryState,
      startVisibilityAt,
      registrationOpenAt,
      registrationCloseAt,
      startAt,
      hasThirdPlaceMatch ? 1 : 0,
    ],
  );

  return Number(insert.insertId);
}

export async function listTournamentBuckets(searchTerm: string | null): Promise<TournamentBuckets> {
  await syncVisibleTournaments();

  const db = await getDatabase();
  const now = new Date();

  const where: string[] = [`t.start_visibility_at <= ?`];
  const params: unknown[] = [now];

  if (searchTerm && searchTerm.trim()) {
    where.push(`LOWER(t.name) LIKE ?`);
    params.push(`%${searchTerm.trim().toLowerCase()}%`);
  }

  const [rows] = await db.execute<TournamentListRow[]>(
    `SELECT
      t.id,
      t.name,
      t.description,
      t.format,
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
     WHERE ${where.join(" AND ")}
     GROUP BY
      t.id,
      t.name,
      t.description,
      t.format,
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
      t.has_third_place_match
     ORDER BY t.start_at DESC`,
    params,
  );

  const buckets: TournamentBuckets = {
    upcoming: [],
    registration: [],
    running: [],
    finished: [],
  };

  for (const row of rows) {
    const card = mapCard(row);
    if (row.state === "UPCOMING") buckets.upcoming.push(card);
    if (row.state === "REGISTRATION") buckets.registration.push(card);
    if (row.state === "RUNNING") buckets.running.push(card);
    if (row.state === "FINISHED") buckets.finished.push(card);
  }

  return buckets;
}

export async function registerCurrentUserTeam(tournamentId: number, userId: number): Promise<void> {
  const db = await getDatabase();
  const activeTeam = await getUserActiveTeam(userId);

  if (!activeTeam) {
    throw new Error("NO_ACTIVE_TEAM");
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { row: tournament } = await syncTournamentState(connection, tournamentId);
    if (!tournament) {
      throw new Error("TOURNAMENT_NOT_FOUND");
    }

    if (tournament.state !== "REGISTRATION") {
      throw new Error("REGISTRATION_CLOSED");
    }

    const [alreadyRegistered] = await connection.execute<(RowDataPacket & { c: number })[]>(
      `SELECT COUNT(*) AS c
       FROM bg_tournament_registrations
       WHERE tournament_id = ?
         AND team_id = ?`,
      [tournamentId, activeTeam.teamId],
    );

    if (Number(alreadyRegistered[0]?.c ?? 0) > 0) {
      throw new Error("ALREADY_REGISTERED");
    }

    const [registrationsCount] = await connection.execute<(RowDataPacket & { c: number })[]>(
      `SELECT COUNT(*) AS c
       FROM bg_tournament_registrations
       WHERE tournament_id = ?`,
      [tournamentId],
    );

    const registeredTeams = Number(registrationsCount[0]?.c ?? 0);
    if (registeredTeams >= Number(tournament.max_teams)) {
      throw new Error("TOURNAMENT_FULL");
    }

    await connection.execute(
      `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed)
       VALUES (?, ?, ?)`,
      [tournamentId, activeTeam.teamId, registeredTeams + 1],
    );

    await connection.commit();

    publishTournamentEvent({
      type: "updated",
      tournamentId,
      emittedAt: new Date().toISOString(),
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getTournamentDetail(tournamentId: number, userId: number, isAdmin = false): Promise<TournamentDetail | null> {
  const db = await getDatabase();
  const activeTeam = await getUserActiveTeam(userId);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { row: tournament } = await syncTournamentState(connection, tournamentId);
    await connection.commit();

    if (!tournament) {
      return null;
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const [cardRows] = await db.execute<TournamentListRow[]>(
    `SELECT
      t.id,
      t.name,
      t.description,
      t.format,
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

  if (cardRows.length === 0) {
    return null;
  }

  const card = mapCard(cardRows[0]);

  const [registrationRows] = await db.execute<RegistrationRow[]>(
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

  const [matchRows] = await db.execute<MatchRow[]>(
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

  const myTeamId = activeTeam?.teamId ?? null;
  const canRegister = Boolean(myTeamId) && card.state === "REGISTRATION" && !registrationRows.some((row) => Number(row.team_id) === myTeamId);

  const canCreateReportsForTeamIds = myTeamId ? [myTeamId] : [];

  return {
    card,
    matches: matchRows.map(mapMatch),
    registrations: registrationRows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      logoUrl: row.logo_url,
      seed: row.seed === null ? null : Number(row.seed),
      registeredAt: row.registered_at.toISOString(),
      finalRank: row.final_rank === null ? null : Number(row.final_rank),
    })),
    canRegister,
    myTeamId,
    canCreateReportsForTeamIds,
    isAdmin,
  };
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
  tournamentId: number,
  matchId: number,
  userId: number,
  myScoreRaw: number,
  opponentScoreRaw: number,
): Promise<void> {
  const myScore = validateScoreValue(myScoreRaw);
  const opponentScore = validateScoreValue(opponentScoreRaw);

  if (myScore === opponentScore) {
    throw new Error("DRAW_NOT_ALLOWED");
  }

  const activeTeam = await getUserActiveTeam(userId);
  if (!activeTeam) {
    throw new Error("NO_ACTIVE_TEAM");
  }

  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

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

    if (
      updated.team1_report_score !== null
      && updated.team1_report_opponent_score !== null
      && updated.team2_report_score !== null
      && updated.team2_report_opponent_score !== null
    ) {
      const consistent =
        Number(updated.team1_report_score) === Number(updated.team2_report_opponent_score)
        && Number(updated.team1_report_opponent_score) === Number(updated.team2_report_score);

      if (consistent) {
        const team1Score = Number(updated.team1_report_score);
        const team2Score = Number(updated.team1_report_opponent_score);
        const winnerTeamId = team1Score > team2Score ? Number(updated.team1_id) : Number(updated.team2_id);
        const loserTeamId = winnerTeamId === Number(updated.team1_id) ? Number(updated.team2_id) : Number(updated.team1_id);

        await finalizeMatch(connection, tournamentId, updated, {
          team1Score,
          team2Score,
          winnerTeamId,
          loserTeamId,
        });

        // Ranks are computed at tournament finalization, not progressively
      } else {
        await connection.execute(`UPDATE bg_matches SET status = 'AWAITING_CONFIRMATION' WHERE id = ?`, [matchId]);

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
          await sendBotLog(
            `[Score conflict] Tournoi "${info.tournament_name}" - Match #${matchId} : ${info.team1_name} vs ${info.team2_name}. Validation admin requise.`,
          );
        }
      }
    }

    await resolveExpiredScoreReports(connection, tournamentId);
    await tryAutoResolveByes(connection, tournamentId);
    await finalizeTournamentIfDone(connection, tournamentId);

    await connection.commit();

    publishTournamentEvent({
      type: "score_reported",
      tournamentId,
      matchId,
      emittedAt: new Date().toISOString(),
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Vérifie que les matchs suivants (downstream) n'ont pas de scores
 * Si un match a un gagnant et que son prochain match (winner ou loser) a des scores,
 * lance une erreur pour empêcher la modification.
 */
async function checkDownstreamMatchesHaveNoScores(
  connection: PoolConnection,
  match: MatchRow,
): Promise<void> {
  // Si le match n'a pas de gagnant, pas besoin de vérifier
  if (match.winner_team_id === null) {
    return;
  }

  const nextWinnerId = match.next_winner_match_id ? Number(match.next_winner_match_id) : null;
  const nextLoserId = match.next_loser_match_id ? Number(match.next_loser_match_id) : null;

  // Vérifier le match suivant du winner bracket (exclure les BYEs : une seule équipe présente)
  if (nextWinnerId) {
    const [results] = await connection.execute<(RowDataPacket & { team1_id: number | null; team2_id: number | null; team1_score: number | null; team2_score: number | null })[]>(
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

  // Vérifier le match suivant du loser bracket (exclure les BYEs : une seule équipe présente)
  if (nextLoserId) {
    const [results] = await connection.execute<(RowDataPacket & { team1_id: number | null; team2_id: number | null; team1_score: number | null; team2_score: number | null })[]>(
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
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

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

    // Vérifier que les matchs suivants n'ont pas de scores
    await checkDownstreamMatchesHaveNoScores(connection, match);

    const tournamentId = Number(match.tournament_id);

    // Juste mettre à jour les scores sans finalize
    if (forfeitTeamId !== undefined) {
      // Forfeit mode - set scores to null and record forfeit
      await connection.execute(
        `UPDATE bg_matches
         SET team1_score = NULL,
             team2_score = NULL,
             forfeit_team_id = ?
         WHERE id = ?`,
        [forfeitTeamId, matchId],
      );
    } else if (team1Score !== undefined && team2Score !== undefined) {
      // Normal score mode
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

    await connection.commit();

    publishTournamentEvent({
      type: "score_resolved",
      tournamentId,
      matchId,
      emittedAt: new Date().toISOString(),
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function adminResolveMatch(
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

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

    // Vérifier que les matchs suivants n'ont pas de scores
    await checkDownstreamMatchesHaveNoScores(connection, match);

    const tournamentId = Number(match.tournament_id);

    let winnerTeamId: number | null;
    let loserTeamId: number | null;
    let resultTeam1Score: number | null;
    let resultTeam2Score: number | null;

    if (forfeitTeamId !== undefined) {
      // Forfeit mode - non-forfeiting team wins
      winnerTeamId = forfeitTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);
      loserTeamId = forfeitTeamId === Number(match.team1_id) ? Number(match.team1_id) : Number(match.team2_id);
      resultTeam1Score = null;
      resultTeam2Score = null;
    } else if (team1Score !== undefined && team2Score !== undefined) {
      // Normal score mode
      winnerTeamId = team1Score > team2Score ? Number(match.team1_id) : Number(match.team2_id);
      loserTeamId = winnerTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);
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

    // Update forfeit_team_id if needed
    if (forfeitTeamId !== undefined) {
      await connection.execute(
        `UPDATE bg_matches SET forfeit_team_id = ? WHERE id = ?`,
        [forfeitTeamId, matchId],
      );
    } else {
      // Clear forfeit if resolving with normal scores
      await connection.execute(
        `UPDATE bg_matches SET forfeit_team_id = NULL WHERE id = ?`,
        [matchId],
      );
    }

    // Ranks are computed at tournament finalization, not progressively
    await tryAutoResolveByes(connection, tournamentId);
    await finalizeTournamentIfDone(connection, tournamentId);

    await connection.commit();

    publishTournamentEvent({
      type: "score_resolved",
      tournamentId,
      matchId,
      emittedAt: new Date().toISOString(),
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
