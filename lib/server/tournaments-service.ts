
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
  bracket: "UPPER" | "LOWER" | "GRAND";
  round_number: number;
  match_number: number;
  status: "PENDING" | "READY" | "AWAITING_CONFIRMATION" | "COMPLETED";
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team_id: number | null;
  loser_team_id: number | null;
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
  return team1Id !== null || team2Id !== null ? "READY" : "PENDING";
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
    team1Score: row.team1_score === null ? null : Number(row.team1_score),
    team2Score: row.team2_score === null ? null : Number(row.team2_score),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    loserTeamId: row.loser_team_id === null ? null : Number(row.loser_team_id),
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
      finished_at
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
  bracket: "UPPER" | "LOWER" | "GRAND",
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
    team1Score: number;
    team2Score: number;
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

  publishTournamentEvent({
    type: "score_resolved",
    tournamentId,
    matchId: Number(match.id),
    emittedAt: new Date().toISOString(),
  });
}
async function tryAutoResolveByes(connection: PoolConnection, tournamentId: number): Promise<void> {
  let hasProgress = true;

  while (hasProgress) {
    hasProgress = false;

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
     WHERE r.tournament_id = ?
     GROUP BY r.team_id
     ORDER BY wins DESC, losses ASC, last_progress_at DESC`,
    [tournamentId],
  );

  let rank = 1;
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
    }
  }
}

async function createBracketIfMissing(connection: PoolConnection, tournament: TournamentRow): Promise<void> {
  const [existingMatches] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches WHERE tournament_id = ?`,
    [tournament.id],
  );

  if (Number(existingMatches[0]?.c ?? 0) > 0) {
    return;
  }

  const registeredTeamIds = await loadRegisteredTeamIds(connection, tournament.id);

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

  const bracketSize = nextPowerOfTwo(registeredTeamIds.length);
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
    const lowerRounds = 2 * rounds - 2;
    for (let lowerRound = 1; lowerRound <= lowerRounds; lowerRound += 1) {
      const phase = Math.ceil(lowerRound / 2);
      const matchesCount = bracketSize / 2 ** (phase + 1);
      lower[lowerRound] = [];
      for (let matchNumber = 1; matchNumber <= matchesCount; matchNumber += 1) {
        const id = await createMatch(connection, tournament.id, "LOWER", lowerRound, matchNumber);
        lower[lowerRound].push(id);
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
      }

      if (tournament.format !== "DOUBLE" || rounds < 2) {
        continue;
      }

      if (round === 1) {
        const target = lower[1][Math.floor(matchIndex / 2)];
        const slot = matchIndex % 2 === 0 ? 1 : 2;
        await linkMatchLoser(connection, source, target, slot);
      } else {
        const targetRound = 2 * round - 2;
        const target = lower[targetRound]?.[matchIndex];
        if (target) {
          await linkMatchLoser(connection, source, target, 2);
        }
      }
    }
  }

  if (tournament.format === "DOUBLE" && rounds >= 2) {
    const lowerRounds = 2 * rounds - 2;

    for (let lowerRound = 1; lowerRound <= lowerRounds; lowerRound += 1) {
      for (let matchIndex = 0; matchIndex < lower[lowerRound].length; matchIndex += 1) {
        const source = lower[lowerRound][matchIndex];

        if (lowerRound === lowerRounds) {
          if (grandFinalMatchId) {
            await linkMatchWinner(connection, source, grandFinalMatchId, 2);
          }
          continue;
        }

        if (lowerRound % 2 === 1) {
          const target = lower[lowerRound + 1][matchIndex];
          await linkMatchWinner(connection, source, target, 1);
        } else {
          const target = lower[lowerRound + 1][Math.floor(matchIndex / 2)];
          const slot = matchIndex % 2 === 0 ? 1 : 2;
          await linkMatchWinner(connection, source, target, slot);
        }
      }
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
      start_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      t.finished_at
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
      t.finished_at`,
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
      m.team1_score,
      m.team2_score,
      m.winner_team_id,
      m.loser_team_id,
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
      FIELD(m.bracket, 'UPPER', 'LOWER', 'GRAND') ASC,
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

export async function adminResolveMatch(
  matchId: number,
  team1Score: number,
  team2Score: number,
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
    if (match.winner_team_id !== null) throw new Error("MATCH_ALREADY_COMPLETED");
    if (match.team1_id === null || match.team2_id === null) throw new Error("MATCH_NOT_READY");

    const winnerTeamId = team1Score > team2Score ? Number(match.team1_id) : Number(match.team2_id);
    const loserTeamId = winnerTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);
    const tournamentId = Number(match.tournament_id);

    await finalizeMatch(connection, tournamentId, match, {
      team1Score,
      team2Score,
      winnerTeamId,
      loserTeamId,
    });

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
