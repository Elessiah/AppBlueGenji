import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { fail, ok } from "@/lib/server/http";

export const revalidate = 300;
export const dynamic = "force-dynamic";

type LeaderboardSourceRow = RowDataPacket & {
  team_id: number;
  team_name: string;
  logo_url: string | null;
  wins: number;
  losses: number;
};

type LeaderboardRow = {
  rank: number;
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  points: number;
  trend: "up" | "down" | "flat";
  trendValue: number;
};

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? "8");
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(50, Math.max(1, Math.trunc(parsed)));
}

function toRankMap(rows: LeaderboardSourceRow[]): Map<number, number> {
  return new Map(rows.map((row, index) => [Number(row.team_id), index + 1]));
}

function mapRows(rows: LeaderboardSourceRow[], previousRanks: Map<number, number>, limit: number): LeaderboardRow[] {
  return rows.slice(0, limit).map((row, index) => {
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
}

async function loadLeaderboardRows(
  db: Awaited<ReturnType<typeof getDatabase>>,
  olderThanSevenDays = false,
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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const game = (url.searchParams.get("game") ?? "all").trim();
    const limit = parseLimit(url.searchParams.get("limit"));

    if (game !== "all") {
      console.warn(`[landing/leaderboard] game=${game} is currently ignored`);
    }

    const db = await getDatabase();
    const currentRows = await loadLeaderboardRows(db, false);
    const previousRows = await loadLeaderboardRows(db, true);
    const previousRanks = toRankMap(previousRows);

    return ok({
      leaderboard: mapRows(currentRows, previousRanks, limit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LANDING_LEADERBOARD_FAILED";
    return fail(message || "LANDING_LEADERBOARD_FAILED", 500);
  }
}
