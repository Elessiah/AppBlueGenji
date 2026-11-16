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

/**
 * À la création d'un arbre d'élimination (`createBracketIfMissing`) : retire
 * les réglages par tour (cartes, map de départage, points) des tours de cette
 * phase que l'arbre n'a pas — au-delà du plus haut tour créé de leur tableau,
 * ou d'un tableau sans aucun match (petite finale retirée, repêchage d'un arbre
 * à deux). Même règle que `roundWithinBuiltBracket` (`lib/shared/round-plan.ts`).
 * Sans cela, invisibles dans l'instantané et la fenêtre « Cartes et bans », ils
 * reprendraient effet sans bruit si un arbre plus grand était régénéré
 * (`discardStaleBracket`). Choix assumé : après un retour en inscriptions, un
 * réglage purgé ne revient pas — le staff le repose, la fenêtre montrant de
 * nouveau tout le plan tant que l'arbre n'est pas recréé.
 *
 * Appelée juste après la création des matchs de la phase : `b.max_round` nul
 * (jointure externe) désigne un tableau que l'arbre n'a pas.
 */
export async function purgeUnbuiltRoundSettings(connection: PoolConnection, tournamentId: number, phaseId: number): Promise<void> {
  await connection.execute(
    `DELETE r FROM bg_tournament_round_maps r
       LEFT JOIN (SELECT bracket, MAX(round_number) AS max_round FROM bg_matches
                   WHERE tournament_id = ? AND phase_id = ? GROUP BY bracket) b ON b.bracket = r.bracket
      WHERE r.tournament_id = ? AND r.phase_id = ?
        AND (b.max_round IS NULL OR r.round_number > b.max_round)`,
    [tournamentId, phaseId, tournamentId, phaseId],
  );
}
