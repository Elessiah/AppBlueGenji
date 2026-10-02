/**
 * BlueGenji Survie — lecture et écriture du classement d'endurance
 * (`bg_endurance_standings`) (`docs/features/BG_SURVIE_MODE.md`).
 */

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { EnduranceStanding, EnduranceStatus } from "@/lib/shared/bg-survie/standings";

export async function loadEnduranceStandings(
  conn: PoolConnection,
  tournamentId: number,
): Promise<EnduranceStanding[]> {
  const [rows] = await conn.execute<
    (RowDataPacket & {
      team_id: number;
      seed: number;
      points: number;
      wins: number;
      losses: number;
      draws: number | null;
      status: EnduranceStatus;
      eliminated_round: number | null;
      rank: number;
    })[]
  >(
    `SELECT team_id, seed, points, wins, losses, draws, status, eliminated_round, \`rank\`
     FROM bg_endurance_standings
     WHERE tournament_id = ?
     ORDER BY \`rank\` ASC, seed ASC`,
    [tournamentId],
  );

  return rows.map((row) => ({
    teamId: Number(row.team_id),
    seed: Number(row.seed),
    points: Number(row.points),
    wins: Number(row.wins),
    losses: Number(row.losses),
    draws: Number(row.draws ?? 0),
    status: row.status,
    eliminatedRound: row.eliminated_round === null ? null : Number(row.eliminated_round),
    rank: Number(row.rank),
    // Le classement stocké est celui de la dernière réconciliation : il fait
    // office d'« ordre précédent » pour les départages à égalité.
    previousRank: Number(row.rank),
  }));
}

/**
 * Lignes par instruction : 10 paramètres chacune, bien en deçà du plafond de
 * 65 535 marqueurs d'une requête préparée, et un plateau entier tient en une.
 */
const STANDINGS_ROWS_PER_STATEMENT = 500;

/**
 * Écrit le classement en **une** instruction multi-lignes plutôt qu'un `INSERT`
 * par équipe : la réconciliation tourne à chaque score, dans sa transaction,
 * et 128 équipes y coûtaient 128 allers-retours verrous tenus. Un upsert et
 * non le `CASE` de la Suisse, parce que le même chemin **sème** le classement
 * (lignes absentes) et le réécrit.
 */
export async function persistStandings(
  conn: PoolConnection,
  tournamentId: number,
  standings: EnduranceStanding[],
): Promise<void> {
  for (let start = 0; start < standings.length; start += STANDINGS_ROWS_PER_STATEMENT) {
    const chunk = standings.slice(start, start + STANDINGS_ROWS_PER_STATEMENT);
    const params = chunk.flatMap((standing) => [
      tournamentId,
      standing.teamId,
      standing.seed,
      standing.points,
      standing.wins,
      standing.losses,
      standing.draws,
      standing.status,
      standing.eliminatedRound,
      standing.rank,
    ]);
    await conn.execute(
      `INSERT INTO bg_endurance_standings
        (tournament_id, team_id, seed, points, wins, losses, draws, status, eliminated_round, \`rank\`)
       VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE
        seed = VALUES(seed), points = VALUES(points), wins = VALUES(wins),
        losses = VALUES(losses), draws = VALUES(draws), status = VALUES(status),
        eliminated_round = VALUES(eliminated_round), \`rank\` = VALUES(\`rank\`)`,
      params,
    );
  }
}
