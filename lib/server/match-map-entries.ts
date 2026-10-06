import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { toIso } from "@/lib/server/serialization";
import type { PersonalDataExport } from "@/lib/shared/types";

/**
 * Détail map par map saisi par le titulaire (`bg_match_maps.submitted_by_user_id`,
 * `docs/features/MAP_SCORES.md`), pour l'export RGPD (droits d'accès et de
 * portabilité) : le site retient qui a saisi chaque map, le titulaire doit
 * pouvoir le lire.
 */
export async function listOwnMapEntries(userId: number): Promise<PersonalDataExport["mapEntries"]> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & {
      match_id: number;
      tournament_id: number;
      source: string;
      map_number: number;
      replay_code: string;
      team1_score: number;
      team2_score: number;
      submitted_at: Date | string | null;
    })[]
  >(
    `SELECT mm.match_id, m.tournament_id, mm.source, mm.map_number, mm.replay_code,
            mm.team1_score, mm.team2_score, mm.submitted_at
     FROM bg_match_maps mm
     JOIN bg_matches m ON m.id = mm.match_id
     WHERE mm.submitted_by_user_id = ?
     ORDER BY mm.match_id, mm.source, mm.map_number`,
    [userId],
  );
  return rows.map((row) => ({
    matchId: Number(row.match_id),
    tournamentId: Number(row.tournament_id),
    source: row.source,
    mapNumber: Number(row.map_number),
    replayCode: row.replay_code,
    team1Score: Number(row.team1_score),
    team2Score: Number(row.team2_score),
    submittedAt: toIso(row.submitted_at ?? null),
  }));
}
