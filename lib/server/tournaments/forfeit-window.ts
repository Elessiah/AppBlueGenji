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

/** Réglages de {@link loadCancellableForfeitIds}. */
export type ForfeitWindowOptions = {
  /**
   * La fenêtre peut encore s'ouvrir : le tournoi est `RUNNING` et, en
   * endurance, les phases finales n'ont pas commencé. Sinon l'interface ne
   * propose aucune annulation (`canCancelForfeits`, `canCancelRow`) et le
   * résultat n'est jamais lu : `[]` d'emblée, sans requête. Vrai par défaut.
   */
  open?: boolean;
  /**
   * Dernière manche portant une saisie quand l'appelant l'a déjà lue (même
   * plage : `lastRoundWithScoreInput` en endurance avant les phases finales) :
   * la requête est alors épargnée.
   */
  lastInputRound?: number;
};

/**
 * Engagés `FORFEIT` dont l'abandon s'annule encore : aucune manche postérieure
 * à la leur ne porte de saisie. Même règle que `laterRoundHasInput` (manche de
 * sortie absente = 1) ; au plus une lecture, et aucune sans ligne forfait,
 * hors fenêtre (`options.open`) ou avec la borne déjà connue
 * (`options.lastInputRound`).
 */
export async function loadCancellableForfeitIds(
  conn: PoolConnection,
  tournamentId: number,
  phaseId: number,
  rows: readonly ForfeitWindowRow[],
  options: ForfeitWindowOptions = {},
): Promise<number[]> {
  if (options.open === false) return [];
  const forfeits = rows.filter((row) => row.status === "FORFEIT");
  if (forfeits.length === 0) return [];
  const lastInputRound = options.lastInputRound ?? (await readLastInputRound(conn, tournamentId, phaseId));
  return forfeits
    .filter((row) => lastInputRound <= (row.forfeitRound ?? 1))
    .map((row) => row.teamId);
}

async function readLastInputRound(conn: PoolConnection, tournamentId: number, phaseId: number): Promise<number> {
  const [lastRows] = await conn.execute<(RowDataPacket & { last_round: number | null })[]>(
    `SELECT MAX(round_number) AS last_round FROM bg_matches
     WHERE tournament_id = ? AND phase_id = ? AND ${HAS_SCORE_INPUT_SQL}`,
    [tournamentId, phaseId],
  );
  return Number(lastRows[0]?.last_round ?? 0);
}
