import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError, isUnknownColumnError } from "@/lib/server/mysql-errors";
import { toIso } from "@/lib/server/serialization";
import type { PersonalDataExport } from "@/lib/shared/types";

/** Ce que l'export dit des matchs où le compte a tenu un rôle (caster, arbitre). */
export type OwnMatchRoles = Pick<PersonalDataExport, "casts" | "providedStreamLinks" | "refereeAssignments">;

type Db = Awaited<ReturnType<typeof getDatabase>>;

/**
 * Une lecture de l'export, tolérée sur une base où sa table ou sa colonne
 * manque encore (migration récente en échec) : rien à rendre plutôt qu'un
 * export refusé — le droit d'accès ne tombe pas pour une colonne.
 */
async function tolerantRows<T extends RowDataPacket>(db: Db, sql: string, userId: number): Promise<T[]> {
  try {
    const [rows] = await db.execute<T[]>(sql, [userId]);
    return rows;
  } catch (error) {
    if (isMissingTableError(error) || isUnknownColumnError(error)) return [];
    throw error;
  }
}

/**
 * Les matchs où le titulaire a tenu un rôle, pour l'export (art. 15 et 20) :
 * ses inscriptions de caster (`bg_match_casters`, avec son « Prêt »), les
 * liens de chaîne qu'il a fournis (`bg_match_streams.link_user_id`, registre
 * T16) et ses arbitrages désignés (`bg_matches.referee_user_id`, avec son
 * « Prêt », registre T04) — ce que le site garde avec le match. Trois
 * lectures, chacune par l'index du compte.
 */
export async function listOwnMatchRoles(userId: number): Promise<OwnMatchRoles> {
  const db = await getDatabase();
  const casts = await tolerantRows<
    RowDataPacket & { match_id: number; tournament_id: number; stream_id: number; ready_at: Date | null; created_at: Date | null }
  >(
    db,
    `SELECT c.match_id, m.tournament_id, c.stream_id, c.ready_at, c.created_at
       FROM bg_match_casters c
       JOIN bg_matches m ON m.id = c.match_id
      WHERE c.user_id = ?
      ORDER BY c.created_at, c.match_id`,
    userId,
  );
  const links = await tolerantRows<
    RowDataPacket & { match_id: number; tournament_id: number; live_url: string | null; created_at: Date | null }
  >(
    db,
    `SELECT s.match_id, m.tournament_id, s.live_url, s.created_at
       FROM bg_match_streams s
       JOIN bg_matches m ON m.id = s.match_id
      WHERE s.link_user_id = ?
      ORDER BY s.created_at, s.match_id`,
    userId,
  );
  const refereed = await tolerantRows<RowDataPacket & { id: number; tournament_id: number; referee_ready_at: Date | null }>(
    db,
    `SELECT id, tournament_id, referee_ready_at FROM bg_matches WHERE referee_user_id = ? ORDER BY id`,
    userId,
  );
  return {
    casts: casts.map((row) => ({
      matchId: Number(row.match_id),
      tournamentId: Number(row.tournament_id),
      streamId: Number(row.stream_id),
      readyAt: toIso(row.ready_at),
      createdAt: toIso(row.created_at),
    })),
    providedStreamLinks: links.map((row) => ({
      matchId: Number(row.match_id),
      tournamentId: Number(row.tournament_id),
      liveUrl: row.live_url,
      createdAt: toIso(row.created_at),
    })),
    refereeAssignments: refereed.map((row) => ({
      matchId: Number(row.id),
      tournamentId: Number(row.tournament_id),
      readyAt: toIso(row.referee_ready_at),
    })),
  };
}
