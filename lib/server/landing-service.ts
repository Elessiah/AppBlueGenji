import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { getSubscribersCount } from "@/lib/server/live";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import {
  inferGameLabel,
  inferPhaseLabel,
  type LandingCalendarEvent,
  type LandingLeaderboardRow,
  type LandingLive,
  type LandingLiveMatch,
  type LandingStats,
  type LandingTickerPayload,
} from "@/lib/shared/landing";
import type { BracketType, TournamentCard } from "@/lib/shared/types";

const DEFAULT_STATS: LandingStats = {
  players: 0,
  teams: 0,
  tournaments: 0,
};

const DEFAULT_TICKER: LandingTickerPayload = {
  items: [
    "RÉSULTAT · En attente de nouveaux matches",
    "INSCRIPTIONS · Prochains brackets à venir",
    "COMMUNAUTÉ · Rejoindre le Discord BlueGenji",
  ],
};

type StatsRow = RowDataPacket & {
  players: number;
  teams: number;
  tournaments: number;
};

export async function getLandingStats(): Promise<LandingStats> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<StatsRow[]>(`
      SELECT
        (SELECT COUNT(*) FROM bg_users) AS players,
        (SELECT COUNT(*) FROM bg_teams) AS teams,
        (SELECT COUNT(*) FROM bg_tournaments) AS tournaments
    `);
    const row = rows[0];
    return {
      players: Number(row?.players ?? 0),
      teams: Number(row?.teams ?? 0),
      tournaments: Number(row?.tournaments ?? 0),
    };
  } catch {
    return DEFAULT_STATS;
  }
}

type LiveMatchRow = RowDataPacket & {
  id: number;
  bracket: BracketType;
  round_number: number;
  match_number: number;
  status: "READY" | "AWAITING_CONFIRMATION" | "COMPLETED" | "PENDING";
  team1_name: string | null;
  team2_name: string | null;
  team1_score: number | null;
  team2_score: number | null;
};

function roundLabelFor(bracket: BracketType, roundNumber: number, matchCount: number): string {
  if ((bracket === "UPPER" || bracket === "GRAND") && matchCount === 1) {
    return "Finale";
  }
  if (matchCount === 2) return "Demi-finale";
  if (matchCount === 4) return "Quarts de finale";
  return `Round ${roundNumber}`;
}

export async function getLandingLive(): Promise<LandingLive | null> {
  try {
    const buckets = await listTournamentBuckets(null);
    const tournament = buckets.running[0] ?? null;
    if (!tournament) return null;

    const db = await getDatabase();
    const [rows] = await db.execute<LiveMatchRow[]>(
      `SELECT
        m.id,
        m.bracket,
        m.round_number,
        m.match_number,
        m.status,
        t1.name AS team1_name,
        t2.name AS team2_name,
        m.team1_score,
        m.team2_score
       FROM bg_matches m
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
       WHERE m.tournament_id = ?
       ORDER BY FIELD(m.bracket, 'UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') ASC,
                m.round_number ASC,
                m.match_number ASC`,
      [tournament.id],
    );

    const currentRow = rows.find((row) => row.status === "READY" || row.status === "AWAITING_CONFIRMATION") ?? null;
    const currentMatch: LandingLiveMatch | null = currentRow
      ? {
          id: Number(currentRow.id),
          team1Name: currentRow.team1_name,
          team2Name: currentRow.team2_name,
          team1Score: currentRow.team1_score === null ? null : Number(currentRow.team1_score),
          team2Score: currentRow.team2_score === null ? null : Number(currentRow.team2_score),
          bracket: currentRow.bracket,
          roundLabel: roundLabelFor(
            currentRow.bracket,
            Number(currentRow.round_number),
            rows.filter((row) => row.bracket === currentRow.bracket).length,
          ),
        }
      : null;

    return {
      tournament,
      currentMatch,
      viewers: getSubscribersCount(tournament.id),
      game: inferGameLabel(tournament.name),
      phase: inferPhaseLabel(currentMatch),
    };
  } catch {
    return null;
  }
}

type LeaderboardSourceRow = RowDataPacket & {
  team_id: number;
  team_name: string;
  logo_url: string | null;
  wins: number;
  losses: number;
};

async function loadLeaderboardRows(
  db: Awaited<ReturnType<typeof getDatabase>>,
  olderThanSevenDays: boolean,
): Promise<LeaderboardSourceRow[]> {
  const where = olderThanSevenDays
    ? `AND m.updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
    : "";
  const [rows] = await db.execute<LeaderboardSourceRow[]>(
    `SELECT
      t.id AS team_id,
      t.name AS team_name,
      t.logo_url,
      COALESCE(SUM(CASE WHEN m.winner_team_id = t.id THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN m.loser_team_id = t.id THEN 1 ELSE 0 END), 0) AS losses
     FROM bg_teams t
     LEFT JOIN bg_matches m
       ON (m.team1_id = t.id OR m.team2_id = t.id)
      AND m.status = 'COMPLETED'
      ${where}
     GROUP BY t.id, t.name, t.logo_url
     ORDER BY (wins * 100 - losses * 20) DESC, wins DESC, t.name ASC`,
  );
  return rows;
}

export async function getLandingLeaderboard(limit = 8): Promise<LandingLeaderboardRow[]> {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  try {
    const db = await getDatabase();
    const [currentRows, previousRows] = await Promise.all([
      loadLeaderboardRows(db, false),
      loadLeaderboardRows(db, true),
    ]);
    const previousRanks = new Map(previousRows.map((row, index) => [Number(row.team_id), index + 1]));

    return currentRows.slice(0, safeLimit).map((row, index) => {
      const rank = index + 1;
      const teamId = Number(row.team_id);
      const points = Number(row.wins ?? 0) * 100 - Number(row.losses ?? 0) * 20;
      const previousRank = previousRanks.get(teamId);
      let trend: "up" | "down" | "flat" = "flat";
      let trendValue = 0;
      if (previousRank !== undefined) {
        const delta = previousRank - rank;
        if (delta > 0) {
          trend = "up";
          trendValue = delta;
        } else if (delta < 0) {
          trend = "down";
          trendValue = Math.abs(delta);
        }
      }
      return {
        rank,
        teamId,
        teamName: row.team_name,
        logoUrl: row.logo_url,
        wins: Number(row.wins ?? 0),
        losses: Number(row.losses ?? 0),
        points,
        trend,
        trendValue,
      };
    });
  } catch {
    return [];
  }
}

function toCalendarEvent(card: TournamentCard): LandingCalendarEvent {
  return {
    tournamentId: card.id,
    name: card.name,
    startAt: card.startAt,
    registrationOpenAt: card.registrationOpenAt,
    registrationCloseAt: card.registrationCloseAt,
    state: card.state,
    maxTeams: card.maxTeams,
    registeredTeams: card.registeredTeams,
  };
}

export async function getLandingCalendar(limit = 5): Promise<LandingCalendarEvent[]> {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  try {
    const buckets = await listTournamentBuckets(null);
    return [...buckets.upcoming, ...buckets.registration, ...buckets.running]
      .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
      .slice(0, safeLimit)
      .map(toCalendarEvent);
  } catch {
    return [];
  }
}

type TickerEntry = { text: string; sortAt: number };

type MatchResultRow = RowDataPacket & {
  updated_at: Date;
  tournament_name: string;
  team1_name: string | null;
  team2_name: string | null;
  team1_score: number | null;
  team2_score: number | null;
  team1_id: number | null;
  team2_id: number | null;
};

type RegistrationRow = RowDataPacket & {
  start_at: Date;
  registration_open_at: Date;
  name: string;
  registered_teams: number;
  max_teams: number;
};

type WinnerRow = RowDataPacket & {
  finished_at: Date | null;
  name: string;
  winner_name: string | null;
};

async function loadNewsEntries(db: Awaited<ReturnType<typeof getDatabase>>): Promise<TickerEntry[]> {
  try {
    const [rows] = await db.execute<
      (RowDataPacket & { title: string; created_at: Date })[]
    >(
      `SELECT title, created_at
       FROM bg_news
       ORDER BY created_at DESC
       LIMIT 3`,
    );
    return rows.map((row) => ({
      text: `NEWS · ${row.title}`,
      sortAt: new Date(row.created_at).getTime(),
    }));
  } catch {
    return [];
  }
}

export async function getLandingTicker(): Promise<LandingTickerPayload> {
  try {
    const db = await getDatabase();
    const entries: TickerEntry[] = [];

    const [resultRows] = await db.execute<MatchResultRow[]>(
      `SELECT
        m.updated_at,
        t.name AS tournament_name,
        t1.name AS team1_name,
        t2.name AS team2_name,
        m.team1_score,
        m.team2_score,
        m.team1_id,
        m.team2_id
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
       WHERE m.status = 'COMPLETED'
       ORDER BY m.updated_at DESC
       LIMIT 3`,
    );

    entries.push(
      ...resultRows.map((row) => ({
        text: `RÉSULTAT · ${row.tournament_name} · ${row.team1_name ?? `Equipe #${row.team1_id}`} ${Number(row.team1_score ?? 0)} — ${row.team2_name ?? `Equipe #${row.team2_id}`} ${Number(row.team2_score ?? 0)}`,
        sortAt: new Date(row.updated_at).getTime(),
      })),
    );

    const [registrationRows] = await db.execute<RegistrationRow[]>(
      `SELECT
        t.start_at,
        t.registration_open_at,
        t.name,
        COUNT(r.id) AS registered_teams,
        t.max_teams
       FROM bg_tournaments t
       LEFT JOIN bg_tournament_registrations r ON r.tournament_id = t.id
       WHERE t.state = 'REGISTRATION'
       GROUP BY t.id, t.start_at, t.registration_open_at, t.name, t.max_teams
       ORDER BY t.registration_open_at DESC`,
    );

    entries.push(
      ...registrationRows.map((row) => ({
        text: `INSCRIPTIONS · ${row.name} · ${Number(row.registered_teams)}/${Number(row.max_teams)} équipes`,
        sortAt: new Date(row.registration_open_at).getTime(),
      })),
    );

    const [winnerRows] = await db.execute<WinnerRow[]>(
      `SELECT
        t.finished_at,
        t.name,
        COALESCE(w.name, CONCAT('Equipe #', r.team_id)) AS winner_name
       FROM bg_tournaments t
       LEFT JOIN bg_tournament_registrations r
         ON r.tournament_id = t.id
        AND r.final_rank = 1
       LEFT JOIN bg_teams w ON w.id = r.team_id
       WHERE t.state = 'FINISHED'
       ORDER BY t.finished_at DESC
       LIMIT 2`,
    );

    entries.push(
      ...winnerRows.map((row) => ({
        text: `VAINQUEUR · ${row.name} · ${row.winner_name ?? "Champion inconnu"}`,
        sortAt: new Date(row.finished_at ?? Date.now()).getTime(),
      })),
    );

    entries.push(...(await loadNewsEntries(db)));

    const items = entries
      .sort((left, right) => right.sortAt - left.sortAt)
      .slice(0, 10)
      .map((entry) => entry.text);

    if (items.length === 0) return DEFAULT_TICKER;
    return { items };
  } catch {
    return DEFAULT_TICKER;
  }
}
