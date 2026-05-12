import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";

type MatchRow = {
  id: number;
  team1_name: string | null;
  team2_name: string | null;
  team1_placeholder: string | null;
  team2_placeholder: string | null;
  team1_score: number | null;
  team2_score: number | null;
};

export async function loadMiniBracket(tournamentId: number): Promise<{ a: string; b: string; sa: number | string; sb: number | string }[]> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<(RowDataPacket & MatchRow)[]>(
      `SELECT
        id,
        team1_name,
        team2_name,
        team1_placeholder,
        team2_placeholder,
        team1_score,
        team2_score
       FROM bg_matches
       WHERE tournament_id = ?
       ORDER BY FIELD(bracket, 'UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') ASC,
                round_number ASC,
                match_number ASC
       LIMIT 4`,
      [tournamentId],
    );

    return rows.map((row) => ({
      a: row.team1_name ?? row.team1_placeholder ?? "À venir",
      b: row.team2_name ?? row.team2_placeholder ?? "À venir",
      sa: row.team1_score ?? "—",
      sb: row.team2_score ?? "—",
    }));
  } catch {
    return [];
  }
}
