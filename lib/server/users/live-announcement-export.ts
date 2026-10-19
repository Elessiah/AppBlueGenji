import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { toIso } from "@/lib/server/serialization";
import type { PersonalDataExport } from "@/lib/shared/types";

/**
 * Traces d'annonce #live d'un match de l'une de ses entrées en tournoi
 * individuel (`bg_live_announcements`, registre T16) : le match, son tournoi,
 * la date et si le passage à l'antenne n'a pas été annoncé (refus du bot ou d'AutoMod, soirée close). Droit d'accès (art. 15) : la trace est une donnée détenue, que
 * l'annonce ait abouti ou non, et qu'elle ait porté le pseudo (inscription
 * depuis le 16 octobre 2026) ou « un joueur ». Une trace effacée (avec son
 * match, ou retirée pour un nouvel essai) n'est plus rendue : le site ne la
 * détient plus, même si le message Discord reste.
 */
export async function listOwnLiveAnnouncements(userId: number): Promise<PersonalDataExport["liveAnnouncements"]> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & { match_id: number; tournament_id: number; sent_at: Date | string | null; refused: number | boolean })[]
  >(
    `SELECT a.match_id, m.tournament_id, a.sent_at, a.refused
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
    refused: Boolean(Number(row.refused)),
  }));
}
