import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { toIso } from "@/lib/server/serialization";
import type { PersonalDataExport } from "@/lib/shared/types";

/**
 * Annonces #live d'un match de l'une de ses entrées en tournoi individuel
 * (`bg_live_announcements`, registre T16) : le match, son tournoi et la date
 * de l'annonce. Le titulaire y retrouve les messages qui ont pu publier son
 * pseudo et peut en demander la suppression (droit d'accès, art. 15).
 * Une annonce sans trace (bot indisponible, trace retirée) n'est pas rendue :
 * le site ne la détient pas.
 */
export async function listOwnLiveAnnouncements(userId: number): Promise<PersonalDataExport["liveAnnouncements"]> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & { match_id: number; tournament_id: number; sent_at: Date | string | null })[]
  >(
    `SELECT a.match_id, m.tournament_id, a.sent_at
     FROM bg_live_announcements a
     JOIN bg_matches m ON m.id = a.match_id
     JOIN bg_teams st ON st.solo_user_id = ?
      AND FIND_IN_SET(st.id, REPLACE(a.pairing, ':', ',')) > 0
     ORDER BY a.sent_at, a.match_id`,
    [userId],
  );
  return rows.map((row) => ({
    matchId: Number(row.match_id),
    tournamentId: Number(row.tournament_id),
    sentAt: toIso(row.sent_at),
  }));
}
