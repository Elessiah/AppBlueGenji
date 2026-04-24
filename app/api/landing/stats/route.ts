import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { fail, ok } from "@/lib/server/http";

export const revalidate = 60;
export const dynamic = "force-dynamic";

type LandingStatsRow = RowDataPacket & {
  players: number;
  teams: number;
  tournaments: number;
};

export async function GET() {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<LandingStatsRow[]>(`
      SELECT
        (SELECT COUNT(*) FROM bg_users) AS players,
        (SELECT COUNT(*) FROM bg_teams) AS teams,
        (SELECT COUNT(*) FROM bg_tournaments) AS tournaments
    `);

    const row = rows[0];
    return ok({
      players: Number(row?.players ?? 0),
      teams: Number(row?.teams ?? 0),
      tournaments: Number(row?.tournaments ?? 0),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LANDING_STATS_FAILED";
    return fail(message || "LANDING_STATS_FAILED", 500);
  }
}
