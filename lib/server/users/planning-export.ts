import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { toIso } from "@/lib/server/serialization";
import type { PersonalDataExport } from "@/lib/shared/types";

type SlotRow = RowDataPacket & { tournament_id: number; match_id: number | null; role: string };
type AvailabilityRow = SlotRow & { status: string; preferred: number; updated_at: Date | null };
type AssignmentRow = SlotRow & { source: string; confirmed: number; created_at: Date | null };
type EventRow = SlotRow & { kind: string; source: string; created_at: Date | null };
type Planning = PersonalDataExport["planning"];

/** Le créneau et le rôle d'une ligne, commun à toutes les tables du planning. */
function slotOf(row: SlotRow): { tournamentId: number; matchId: number | null; role: string } {
  return { tournamentId: Number(row.tournament_id), matchId: row.match_id === null ? null : Number(row.match_id), role: row.role };
}

/** Un événement de l'historique, qu'il vise le titulaire ou qu'il en soit l'auteur — jamais l'autre partie. */
function mapEvent(row: EventRow): Planning["history"][number] {
  return { ...slotOf(row), kind: row.kind, source: row.source, createdAt: toIso(row.created_at) };
}

/** Une attribution, sans la personne qui la tient ni celle qui l'a posée. */
function mapAssignment(row: AssignmentRow): Planning["assignmentsSet"][number] {
  return { ...slotOf(row), source: row.source, confirmed: Boolean(row.confirmed), createdAt: toIso(row.created_at) };
}

/**
 * Ce que le planning des casts et arbitres garde du titulaire, pour l'export
 * (art. 15 et 20, `docs/features/CAST_PLANNING.md`) : ses disponibilités et
 * préférences, les attributions qui le nomment (avec leur motif : préférence,
 * charge, choix du staff…), leur historique (attribué,
 * confirmé, retiré, désistement avec son motif — sans dire quel membre du staff a fait le geste), ses
 * propres gestes comme staff (événements dont il est l'auteur, attributions
 * qu'il a posées — sans l'identifiant de la personne visée, art. 15.4) et son réglage
 * « caster autonome ». Tables tolérées : une base qui en manque n'a rien à exporter.
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
  const [availability, assignments, events, acted, set, profiles] = await Promise.all([
    tolerant<AvailabilityRow>(
      `SELECT tournament_id, match_id, role, status, preferred, updated_at
         FROM bg_planning_availability WHERE user_id = ? ORDER BY updated_at, entry_key, role`,
    ),
    tolerant<AssignmentRow & { reason: string }>(
      `SELECT tournament_id, match_id, role, source, reason, confirmed, created_at
         FROM bg_planning_assignments WHERE user_id = ? ORDER BY created_at, entry_key, role`,
    ),
    tolerant<EventRow & { reason: string | null; late: number; staff_release: number | null }>(
      `SELECT tournament_id, match_id, role, kind, source, reason, late, staff_release, created_at
         FROM bg_planning_events WHERE user_id = ? ORDER BY created_at, id`,
    ),
    tolerant<EventRow & { staff_release: number | null }>(
      `SELECT tournament_id, match_id, role, kind, source, staff_release, created_at
         FROM bg_planning_events WHERE actor_user_id = ? ORDER BY created_at, id`,
    ),
    tolerant<AssignmentRow>(
      `SELECT tournament_id, match_id, role, source, confirmed, created_at
         FROM bg_planning_assignments WHERE assigned_by_user_id = ? ORDER BY created_at, entry_key, role`,
    ),
    tolerant<RowDataPacket & { solo_caster: number }>(`SELECT solo_caster FROM bg_planning_profiles WHERE user_id = ?`),
  ]);
  return {
    availability: availability.map((row) => ({
      ...slotOf(row),
      status: row.status,
      preferred: Boolean(row.preferred),
      updatedAt: toIso(row.updated_at),
    })),
    assignments: assignments.map((row) => ({ ...mapAssignment(row), reason: row.reason })),
    history: events.map((row) =>
      row.kind === "WITHDRAWN"
        ? {
            ...mapEvent(row),
            reason: row.reason,
            late: Boolean(row.late),
            // Sortie du planning par le staff (compte passé invité) : pas un désistement de sa part.
            ...(Number(row.staff_release ?? 0) === 1 ? { staffRelease: true } : {}),
          }
        : mapEvent(row),
    ),
    // Ses gestes de staff : la sortie d'un invité qu'il a faite porte la même marque que dans l'historique de l'invité
    // (ce n'est pas un désistement de sa part).
    staffActions: acted.map((row) => (Number(row.staff_release ?? 0) === 1 ? { ...mapEvent(row), staffRelease: true } : mapEvent(row))),
    assignmentsSet: set.map(mapAssignment),
    soloCaster: profiles.length > 0 ? Boolean(profiles[0].solo_caster) : null,
  };
}
