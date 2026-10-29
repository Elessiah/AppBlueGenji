/**
 * Lecture des créneaux de cartes d'un tour (`docs/features/ROUND_MAPS.md`),
 * partagée par les cartes par tour (`./round-maps`) et par la première carte
 * d'un match (`./match-launch`, `setMatchFirstMap`) — un module à part, que
 * les deux importent sans s'importer l'un l'autre.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { parseStoredSlots, type RoundKey } from "@/lib/shared/round-maps";

/** Les créneaux d'un tour du tournoi, vides sans réglage (lecture tolérante). */
export async function loadRoundSlots(connection: PoolConnection, tournamentId: number, round: RoundKey): Promise<string[][]> {
  const [rows] = await connection.execute<(RowDataPacket & { slots_json: string | null })[]>(
    `SELECT slots_json FROM bg_tournament_round_maps
      WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ? LIMIT 1`,
    [tournamentId, round.phaseId, round.bracket, round.roundNumber],
  );
  return parseStoredSlots(rows[0]?.slots_json);
}
