/**
 * Points par carte réglés **carte par carte** sur un tour, format Duel / Arcade
 * (`docs/features/DUEL_ARCADE.md`) : le cas seedé qui montre map 1, 2 et 3 à
 * des N différents (fenêtre des cartes, page du match, saisie du score).
 */
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { SEED_TOURNAMENT_PREFIX } from "./cases";

/** Tournoi seedé (BO3, premier à 5) et réglage carte par carte de son premier tour. */
export const SEED_MAP_POINT_TARGET_CASES = [
  // Carte 1 suit le tournoi (5), carte 2 au premier à 3, carte décisive au premier à 7.
  { caseName: "Duel Arcade BO3 (points par carte)", round: 1, targets: [null, 3, 7] },
] as const;

/**
 * Pose les points carte par carte seedés sur le tour (tableau principal, phase 0).
 * Échoue si le tournoi manque : un renommage ferait sinon taire le cas.
 */
export async function applyMapPointTargetCases(db: Pool): Promise<void> {
  for (const pointCase of SEED_MAP_POINT_TARGET_CASES) {
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO bg_tournament_round_maps
         (tournament_id, phase_id, bracket, round_number, slots_json, map_point_targets)
       SELECT t.id, 0, 'UPPER', ?, '[]', ?
         FROM bg_tournaments t
        WHERE t.name = ?
        LIMIT 1
       ON DUPLICATE KEY UPDATE map_point_targets = VALUES(map_point_targets)`,
      [pointCase.round, JSON.stringify(pointCase.targets), `${SEED_TOURNAMENT_PREFIX}${pointCase.caseName}`],
    );
    if (result.affectedRows === 0) throw new Error(`SEED_MAP_POINT_TARGET_CASE_MISSING: ${pointCase.caseName}`);
  }
}
