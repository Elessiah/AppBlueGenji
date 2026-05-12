import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { TournamentBuckets, TournamentDetail, TournamentFormat, TournamentState } from "@/lib/shared/types";
import { getDatabase } from "@/lib/server/database";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import type { TournamentRow, TournamentListRow } from "./_internal";

// Internal types
export type { TournamentRow, RegistrationRow, MatchRow, TournamentListRow } from "./_internal";
export { mapCard, mapMatch, statusFromTeams } from "./_internal";

// State management
export { computeTournamentState, syncTournamentState, hasPendingStateTransition } from "./state";

// Registration (registerCurrentUserTeam is wrapped as public API function)
export { canUserRegister } from "./registration";

// Bracket generation
export { createBracketIfMissing } from "./bracket-generator";

// Scoring
export { reportMatchScore, finalizeMatch } from "./scoring";

// Admin (adminResolveMatch is wrapped as public API function)
export { adminSaveMatchScores, checkDownstreamMatchesHaveNoScores } from "./admin";

// Notifications
export { publishUpdatedEvent, publishScoreReportedEvent, publishScoreResolvedEvent, sendBotLogAsync } from "./notifications";

// Repository
export {
  loadTournamentRow,
  loadRegisteredTeamIds,
  createMatch,
  setMatchParticipants,
  updateTournamentState,
  updateTournamentBracketSize,
  finishTournament,
  getRegistrationRows,
  getMatchRows,
  getTournamentListRow,
  hasExistingMatches,
  deleteAllMatches,
  resetRegistrationRanks,
} from "./repository";

// Byes
export { tryAutoResolveByes } from "./byes";

// Finalization
export { finalizeTournamentIfDone, resolveExpiredScoreReports } from "./finalization";

// Public API functions
import { syncTournamentState } from "./state";
import { registerCurrentUserTeam as registerTeamInternal } from "./registration";
import { resolveExpiredScoreReports, finalizeTournamentIfDone } from "./finalization";
import { tryAutoResolveByes } from "./byes";
import { mapCard, mapMatch } from "./_internal";
import { getTournamentListRow, getRegistrationRows, getMatchRows, loadTournamentRow } from "./repository";
import { reportMatchScore } from "./scoring";
import { publishUpdatedEvent, publishScoreReportedEvent, sendBotLogAsync } from "./notifications";

let pendingSync: Promise<void> | null = null;
let lastSyncAt = 0;
const SYNC_THROTTLE_MS = 1000;

async function syncVisibleTournaments(): Promise<void> {
  if (pendingSync) return pendingSync;
  if (Date.now() - lastSyncAt < SYNC_THROTTLE_MS) return;

  pendingSync = (async () => {
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
      publishUpdatedEvent(id);
    }
  })();

  try {
    await pendingSync;
  } finally {
    lastSyncAt = Date.now();
    pendingSync = null;
  }
}

export async function createTournament(
  organizerUserId: number,
  payload: {
    name: string;
    description: string | null;
    format: TournamentFormat;
    game?: "OW2" | "MR";
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
    Number.isNaN(startVisibilityAt.getTime()) ||
    Number.isNaN(registrationOpenAt.getTime()) ||
    Number.isNaN(registrationCloseAt.getTime()) ||
    Number.isNaN(startAt.getTime())
  ) {
    throw new Error("INVALID_DATES");
  }

  if (
    !(
      startVisibilityAt <= registrationOpenAt &&
      registrationOpenAt <= registrationCloseAt &&
      registrationCloseAt <= startAt
    )
  ) {
    throw new Error("INVALID_DATE_ORDER");
  }

  const { computeTournamentState } = await import("./state");

  const temporaryState: TournamentState = computeTournamentState({
    state: "UPCOMING",
    finished_at: null,
    registration_open_at: registrationOpenAt,
    registration_close_at: registrationCloseAt,
    start_at: startAt,
  });

  const hasThirdPlaceMatch = payload.format === "SINGLE" && Boolean(payload.hasThirdPlaceMatch);
  const game = payload.game ?? "OW2";

  const [insert] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments (
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
      has_third_place_match
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      organizerUserId,
      payload.name.trim(),
      payload.description,
      payload.format,
      game,
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
     WHERE ${where.join(" AND ")}
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
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await registerTeamInternal(connection, tournamentId, userId);
    await connection.commit();

    publishUpdatedEvent(tournamentId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function hasExpiredScoreReports(
  db: Awaited<ReturnType<typeof getDatabase>>,
  tournamentId: number,
): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_matches WHERE tournament_id = ? AND status = 'AWAITING_CONFIRMATION' AND score_deadline_at <= NOW() LIMIT 1`,
    [tournamentId],
  );
  return rows.length > 0;
}

export async function getTournamentDetail(
  tournamentId: number,
  userId: number,
  isAdmin = false,
): Promise<TournamentDetail | null> {
  const db = await getDatabase();
  const activeTeam = await getUserActiveTeam(userId);

  const tournamentRow = await loadTournamentRow(await db.getConnection(), tournamentId);
  if (!tournamentRow) return null;

  const { hasPendingStateTransition } = await import("./state");

  const needsSync =
    tournamentRow.state === "RUNNING" &&
    (tournamentRow.bracket_size === null ||
      (await hasExpiredScoreReports(db, tournamentId)) ||
      (await hasPendingStateTransition(tournamentRow)));

  let tournament: TournamentRow | null = tournamentRow;
  if (needsSync) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const syncResult = await syncTournamentState(connection, tournamentId);
      tournament = syncResult.row;
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  if (!tournament) {
    return null;
  }

  const connection = await db.getConnection();
  try {
    const cardRow = await getTournamentListRow(connection, tournamentId);
    if (!cardRow) return null;

    const card = mapCard(cardRow);
    const registrations = await getRegistrationRows(connection, tournamentId);
    const matches = await getMatchRows(connection, tournamentId);

    const myTeamId = activeTeam?.teamId ?? null;
    const canRegister =
      Boolean(myTeamId) &&
      card.state === "REGISTRATION" &&
      !registrations.some((row) => Number(row.team_id) === myTeamId);

    const canCreateReportsForTeamIds = myTeamId ? [myTeamId] : [];

    return {
      card,
      matches: matches.map(mapMatch),
      registrations: registrations.map((row) => ({
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
  } finally {
    connection.release();
  }
}

export async function reportMatchScorePublic(
  tournamentId: number,
  matchId: number,
  userId: number,
  myScoreRaw: number,
  opponentScoreRaw: number,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  let pendingBotLog: string | null = null;

  try {
    await connection.beginTransaction();

    pendingBotLog = await reportMatchScore(
      connection,
      tournamentId,
      matchId,
      userId,
      myScoreRaw,
      opponentScoreRaw,
    );

    await resolveExpiredScoreReports(connection, tournamentId);
    await tryAutoResolveByes(connection, tournamentId);
    await finalizeTournamentIfDone(connection, tournamentId);

    await connection.commit();

    publishScoreReportedEvent(tournamentId, matchId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    if (pendingBotLog) {
      await sendBotLogAsync(pendingBotLog);
    }
  }
}

export async function adminSaveMatchScoresPublic(
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { adminSaveMatchScores: adminSaveInternal } = await import("./admin");
    await adminSaveInternal(connection, matchId, team1Score, team2Score, forfeitTeamId);

    await connection.commit();

    // Need to get tournament ID for event
    const [matchData] = await connection.execute<(RowDataPacket & { tournament_id: number })[]>(
      `SELECT tournament_id FROM bg_matches WHERE id = ? LIMIT 1`,
      [matchId],
    );

    if (matchData.length > 0) {
      publishScoreResolvedEvent(Number(matchData[0].tournament_id), matchId);
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function adminResolveMatchPublic(
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Get tournament ID from match
    const [matchData] = await connection.execute<(RowDataPacket & { tournament_id: number })[]>(
      `SELECT tournament_id FROM bg_matches WHERE id = ? LIMIT 1`,
      [matchId],
    );

    if (matchData.length === 0) throw new Error("MATCH_NOT_FOUND");
    const tournamentId = Number(matchData[0].tournament_id);

    const { adminResolveMatch } = await import("./admin");
    await adminResolveMatch(connection, matchId, team1Score, team2Score, forfeitTeamId);

    await tryAutoResolveByes(connection, tournamentId);
    await finalizeTournamentIfDone(connection, tournamentId);

    await connection.commit();

    publishScoreReportedEvent(tournamentId, matchId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
