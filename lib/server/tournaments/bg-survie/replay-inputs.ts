/**
 * BlueGenji Survie — ce que le rejeu lit en base : les matchs de la phase
 * qualificative, les pénalités et les abandons (`docs/features/BG_SURVIE_MODE.md`).
 */

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { rowsOrEmptyIfMissingTable } from "@/lib/server/mysql-errors";
import {
  enduranceMatchOutcome,
  type EnduranceMatchOutcome,
} from "@/lib/shared/bg-survie/match-outcome";
import type { EndurancePenalty } from "@/lib/shared/bg-survie/replay";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";

/** Matchs de la phase qualificative, sous forme de résultats rejouables. */
export async function loadQualificationOutcomes(
  conn: PoolConnection,
  tournamentId: number,
): Promise<EnduranceMatchOutcome[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      round_number: number;
      status: string;
      team1_id: number | null;
      team2_id: number | null;
      team1_score: number | null;
      team2_score: number | null;
      winner_team_id: number | null;
      loser_team_id: number | null;
      forfeit_team_id: number | null;
      double_forfeit: number | null;
    })[]
  >(
    `SELECT round_number, status, team1_id, team2_id, team1_score, team2_score,
            winner_team_id, loser_team_id, forfeit_team_id, double_forfeit
     FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number < ?
     ORDER BY round_number ASC, match_number ASC`,
    [tournamentId, PLAYOFF_ROUND_OFFSET],
  );

  // La lecture d'une ligne vit dans le module pur (`enduranceMatchOutcome`) :
  // l'aperçu de la manche suivante la rejoue côté interface sur les matchs de
  // l'instantané, et deux lectures d'un même match finiraient par diverger.
  return rows.map((row) =>
    enduranceMatchOutcome({
      round: Number(row.round_number),
      status: String(row.status),
      team1Id: row.team1_id === null ? null : Number(row.team1_id),
      team2Id: row.team2_id === null ? null : Number(row.team2_id),
      team1Score: row.team1_score === null ? null : Number(row.team1_score),
      team2Score: row.team2_score === null ? null : Number(row.team2_score),
      winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
      loserTeamId: row.loser_team_id === null ? null : Number(row.loser_team_id),
      // `!= null` couvre aussi une colonne absente : un forfait doit être une
      // information positive, jamais un défaut.
      forfeitTeamId: row.forfeit_team_id == null ? null : Number(row.forfeit_team_id),
      doubleForfeit: Number(row.double_forfeit ?? 0) === 1,
    }),
  );
}

/**
 * Pénalités d'endurance du tournoi, telles qu'elles entrent dans le rejeu.
 *
 * Lues à chaque réconciliation plutôt que cumulées quelque part : le classement
 * est écrasé à chaque entretien, un total qui y vivrait ne survivrait pas au
 * premier score corrigé.
 */
export async function loadPenalties(
  conn: PoolConnection,
  tournamentId: number,
): Promise<EndurancePenalty[]> {
  // Table tolérée absente : aucune sanction n'a pu y être posée, et une base
  // qui en manque ne doit pas faire échouer tout report de score du mode.
  const rows = await rowsOrEmptyIfMissingTable(
    conn.execute<(RowDataPacket & { team_id: number; round_number: number; points: number })[]>(
      `SELECT team_id, round_number, points
       FROM bg_endurance_penalties
       WHERE tournament_id = ?
       ORDER BY round_number ASC, id ASC`,
      [tournamentId],
    ),
  );

  return rows.map((row) => ({
    teamId: Number(row.team_id),
    round: Number(row.round_number),
    points: Number(row.points),
  }));
}

/** Abandons déclarés, dérivés du statut FORFEIT déjà stocké. */
export async function loadForfeits(
  conn: PoolConnection,
  tournamentId: number,
): Promise<{ teamId: number; round: number }[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & { team_id: number; eliminated_round: number | null })[]
  >(
    `SELECT team_id, eliminated_round
     FROM bg_endurance_standings
     WHERE tournament_id = ? AND status = 'FORFEIT'`,
    [tournamentId],
  );

  return rows.map((row) => ({
    teamId: Number(row.team_id),
    round: Number(row.eliminated_round ?? 1),
  }));
}
