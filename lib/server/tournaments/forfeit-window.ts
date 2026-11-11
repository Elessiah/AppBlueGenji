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
import type { MatchRow } from "./_internal";

/** Ce qu'il faut d'un match pour juger s'il porte une saisie. */
export type ScoreInputMatchRow = Pick<
  MatchRow,
  | "round_number"
  | "phase_id"
  | "status"
  | "team1_id"
  | "team2_id"
  | "team1_score"
  | "team2_score"
  | "winner_team_id"
  | "forfeit_team_id"
  | "double_forfeit"
  | "team1_reported_at"
  | "team2_reported_at"
>;

/** Même règle que `HAS_SCORE_INPUT_SQL`, sur une ligne déjà chargée. */
function rowHasScoreInput(row: ScoreInputMatchRow): boolean {
  if (row.team1_id === null || row.team2_id === null) return false;
  return (
    row.team1_score !== null ||
    row.team2_score !== null ||
    row.winner_team_id !== null ||
    row.forfeit_team_id !== null ||
    (Number(row.double_forfeit ?? 0) === 1 && row.status === "COMPLETED") ||
    row.status === "AWAITING_CONFIRMATION" ||
    row.team1_reported_at !== null ||
    row.team2_reported_at !== null
  );
}

/**
 * Dernière manche de la phase `phaseId` portant une saisie, lue sur les matchs
 * **déjà chargés** par l'instantané : la borne de {@link loadCancellableForfeitIds}
 * (`options.lastInputRound`) sans relire `bg_matches` à chaque instantané. 0
 * quand aucune manche n'a de saisie, comme la requête.
 */
export function lastInputRoundOf(matches: readonly ScoreInputMatchRow[], phaseId: number): number {
  let last = 0;
  for (const row of matches) {
    if (Number(row.phase_id ?? 0) !== phaseId || !rowHasScoreInput(row)) continue;
    last = Math.max(last, Number(row.round_number));
  }
  return last;
}

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
 * à la leur ne porte de saisie. Même règle que `laterRoundsHaveScoreInput` (manche de
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
