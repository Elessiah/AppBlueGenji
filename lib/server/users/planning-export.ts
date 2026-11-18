import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { toIso } from "@/lib/server/serialization";
import type { PersonalDataExport } from "@/lib/shared/types";

/**
 * Ce que le planning des casts et arbitres garde du titulaire, pour l'export
 * (art. 15 et 20, `docs/features/CAST_PLANNING.md`) : ses disponibilités et
 * préférences, les attributions qui le nomment, leur historique (attribué,
 * confirmé, retiré — sans dire quel membre du staff a fait le geste) et son
 * réglage « caster autonome ». Tables tolérées : une base qui en manque n'a rien à exporter.
 */
export async function exportOwnPlanning(userId: number): Promise<PersonalDataExport["planning"]> {
  const db = await getDatabase();
  const tolerant = async <T extends RowDataPacket>(sql: string): Promise<T[]> => {
    try {
      const [rows] = await db.execute<T[]>(sql, [userId]);
      return rows;
    } catch (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
  };
  const [availability, assignments, events, profiles] = await Promise.all([
    tolerant<RowDataPacket & { entry_key: string; tournament_id: number; match_id: number | null; role: string; status: string; preferred: number; updated_at: Date | null }>(
      `SELECT entry_key, tournament_id, match_id, role, status, preferred, updated_at
         FROM bg_planning_availability WHERE user_id = ? ORDER BY updated_at, entry_key, role`,
    ),
    tolerant<RowDataPacket & { entry_key: string; tournament_id: number; match_id: number | null; role: string; source: string; confirmed: number; created_at: Date | null }>(
      `SELECT entry_key, tournament_id, match_id, role, source, confirmed, created_at
         FROM bg_planning_assignments WHERE user_id = ? ORDER BY created_at, entry_key, role`,
    ),
    tolerant<RowDataPacket & { tournament_id: number; match_id: number | null; role: string; kind: string; source: string; created_at: Date | null }>(
      `SELECT tournament_id, match_id, role, kind, source, created_at
         FROM bg_planning_events WHERE user_id = ? ORDER BY created_at, id`,
    ),
    tolerant<RowDataPacket & { solo_caster: number }>(`SELECT solo_caster FROM bg_planning_profiles WHERE user_id = ?`),
  ]);
  return {
    availability: availability.map((row) => ({
      tournamentId: Number(row.tournament_id),
      matchId: row.match_id === null ? null : Number(row.match_id),
      role: row.role,
      status: row.status,
      preferred: Boolean(row.preferred),
      updatedAt: toIso(row.updated_at),
    })),
    assignments: assignments.map((row) => ({
      tournamentId: Number(row.tournament_id),
      matchId: row.match_id === null ? null : Number(row.match_id),
      role: row.role,
      source: row.source,
      confirmed: Boolean(row.confirmed),
      createdAt: toIso(row.created_at),
    })),
    history: events.map((row) => ({
      tournamentId: Number(row.tournament_id),
      matchId: row.match_id === null ? null : Number(row.match_id),
      role: row.role,
      kind: row.kind,
      source: row.source,
      createdAt: toIso(row.created_at),
    })),
    soloCaster: profiles.length > 0 ? Boolean(profiles[0].solo_caster) : null,
  };
}
