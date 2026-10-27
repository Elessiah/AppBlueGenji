/**
 * Fenêtre d'annulation d'un abandon, lue pour l'affichage
 * (`docs/features/FORFEIT_CANCELLATION.md`).
 *
 * `cancelTournamentForfeit` refuse (`FORFEIT_ROUND_PASSED`) dès qu'une manche
 * **postérieure** à celle de l'abandon porte une saisie. L'interface reçoit la
 * même borne, calculée ici, pour ne pas proposer un bouton voué au refus :
 * l'administrateur confirmait, puis apprenait seulement alors que le geste
 * était fermé.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { HAS_SCORE_INPUT_SQL } from "./bg-survie/round-progress";

/** Ligne de classement vue par la fenêtre : statut et manche de sortie. */
export type ForfeitWindowRow = {
  teamId: number;
  status: string;
  /** Manche de l'abandon (`forfeit_round` en suisse, `eliminated_round` sinon). */
  forfeitRound: number | null;
};

/**
 * Engagés `FORFEIT` dont l'abandon s'annule encore : aucune manche postérieure
 * à la leur ne porte de saisie. Même règle que `laterRoundHasInput` (manche de
 * sortie absente = 1) ; une seule lecture, et aucune sans ligne forfait.
 */
export async function loadCancellableForfeitIds(
  conn: PoolConnection,
  tournamentId: number,
  phaseId: number,
  rows: readonly ForfeitWindowRow[],
): Promise<number[]> {
  const forfeits = rows.filter((row) => row.status === "FORFEIT");
  if (forfeits.length === 0) return [];
  const [lastRows] = await conn.execute<(RowDataPacket & { last_round: number | null })[]>(
    `SELECT MAX(round_number) AS last_round FROM bg_matches
     WHERE tournament_id = ? AND phase_id = ? AND ${HAS_SCORE_INPUT_SQL}`,
    [tournamentId, phaseId],
  );
  const lastInputRound = Number(lastRows[0]?.last_round ?? 0);
  return forfeits
    .filter((row) => lastInputRound <= (row.forfeitRound ?? 1))
    .map((row) => row.teamId);
}
