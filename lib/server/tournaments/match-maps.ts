import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { MatchMapInput, MatchMapResult } from "@/lib/shared/match-maps";

/**
 * Stockage du détail map par map (`bg_match_maps`, `docs/features/MAP_SCORES.md`).
 *
 * Trois jeux de lignes par match : la proposition de chaque engagée (`TEAM1`,
 * `TEAM2`) et le résultat retenu (`FINAL`). Les scores sont toujours écrits
 * dans l'orientation du plateau. Aucune de ces écritures ne touche
 * `bg_matches` : le score dérivé y est posé par l'appelant, par le chemin
 * habituel (`finalizeMatch`, sauvegarde d'arbitrage).
 */

export type MatchMapSource = "TEAM1" | "TEAM2" | "FINAL";

type MapRow = RowDataPacket & {
  match_id: number;
  source: MatchMapSource;
  map_number: number;
  replay_code: string;
  team1_score: number;
  team2_score: number;
};

/** Remplace le jeu de maps `source` d'un match. Une liste vide l'efface. */
export async function replaceMatchMaps(
  connection: PoolConnection,
  matchId: number,
  source: MatchMapSource,
  maps: ReadonlyArray<MatchMapInput>,
  userId: number | null,
): Promise<void> {
  await clearMatchMaps(connection, matchId, source);
  if (maps.length === 0) return;
  const placeholders = maps.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
  const values = maps.flatMap((map, index) => [
    matchId,
    source,
    index + 1,
    map.replayCode,
    map.team1Score,
    map.team2Score,
    userId,
  ]);
  await connection.execute(
    `INSERT INTO bg_match_maps
       (match_id, source, map_number, replay_code, team1_score, team2_score, submitted_by_user_id)
     VALUES ${placeholders}`,
    values,
  );
}

/**
 * Efface un jeu de maps **s'il existe**. Un `DELETE` qui ne trouve rien pose
 * quand même un verrou d'intervalle (InnoDB, `REPEATABLE READ`) : deux reports
 * simultanés sur deux matchs encore sans ligne verrouillaient le même
 * intervalle, puis s'attendaient l'un l'autre à l'insertion — interblocage, et
 * un 500 pour l'une des deux équipes. La lecture préalable est une lecture
 * cohérente, sans verrou ; elle ne court aucune course pour ce match-ci, dont
 * la ligne `bg_matches` est déjà verrouillée par l'appelant.
 */
async function clearMatchMaps(connection: PoolConnection, matchId: number, source: MatchMapSource): Promise<void> {
  const result = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_maps WHERE match_id = ? AND source = ? LIMIT 1`,
    [matchId, source],
  );
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
  if (rows.length === 0) return;
  await connection.execute(`DELETE FROM bg_match_maps WHERE match_id = ? AND source = ?`, [matchId, source]);
}

/** Maps d'un jeu précis, dans l'ordre joué. */
export async function loadMatchMaps(
  connection: PoolConnection,
  matchId: number,
  source: MatchMapSource,
): Promise<MatchMapResult[]> {
  const [rows] = await connection.execute<MapRow[]>(
    `SELECT match_id, source, map_number, replay_code, team1_score, team2_score
     FROM bg_match_maps
     WHERE match_id = ? AND source = ?
     ORDER BY map_number`,
    [matchId, source],
  );
  return Array.isArray(rows) ? rows.map(toResult) : [];
}

/**
 * La proposition d'une engagée devient le résultat retenu (accord des deux, ou
 * report seul à l'échéance du délai). À appeler **avant** `finalizeMatch`, qui
 * efface ensuite les propositions avec leurs colonnes de score.
 */
export async function promoteReportedMaps(
  connection: PoolConnection,
  matchId: number,
  from: "TEAM1" | "TEAM2",
): Promise<void> {
  await clearMatchMaps(connection, matchId, "FINAL");
  await connection.execute(
    `INSERT INTO bg_match_maps
       (match_id, source, map_number, replay_code, team1_score, team2_score, submitted_by_user_id, submitted_at)
     SELECT match_id, 'FINAL', map_number, replay_code, team1_score, team2_score, submitted_by_user_id, submitted_at
     FROM bg_match_maps
     WHERE match_id = ? AND source = ?`,
    [matchId, from],
  );
}

/**
 * Efface des jeux de maps sur plusieurs matchs, **s'il y en a** (même raison
 * que `clearMatchMaps` : pas de verrou d'intervalle pour rien).
 *
 * Les propositions (`TEAM1`, `TEAM2`) partent dès que leurs colonnes de score
 * partent — clôture (`finalizeMatch`), abandon d'un moteur à classement,
 * retour en arrière : elles ne documentent plus aucun résultat, et `/rgpd`
 * promet de ne garder un code que avec le résultat qu'il documente. Le retour
 * en arrière emporte aussi `FINAL`, le résultat qu'il décrivait étant défait.
 */
export async function clearMapSets(
  connection: PoolConnection,
  matchIds: ReadonlyArray<number>,
  sources: ReadonlyArray<MatchMapSource>,
): Promise<void> {
  if (matchIds.length === 0 || sources.length === 0) return;
  const where = `match_id IN (${matchIds.map(() => "?").join(", ")})
       AND source IN (${sources.map(() => "?").join(", ")})`;
  const params = [...matchIds, ...sources];
  const result = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_maps WHERE ${where} LIMIT 1`,
    params,
  );
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
  if (rows.length === 0) return;
  await connection.execute(`DELETE FROM bg_match_maps WHERE ${where}`, params);
}

/** Propositions d'équipe d'un match (voir {@link clearMapSets}). */
export const REPORTED_MAP_SOURCES: ReadonlyArray<MatchMapSource> = ["TEAM1", "TEAM2"];

export interface MatchMapSets {
  final: MatchMapResult[];
  team1: MatchMapResult[];
  team2: MatchMapResult[];
}

const SET_KEY: Readonly<Record<MatchMapSource, keyof MatchMapSets>> = {
  FINAL: "final",
  TEAM1: "team1",
  TEAM2: "team2",
};

/** Maps de plusieurs matchs en une requête — l'instantané d'un tournoi. */
export async function loadMapsByMatch(
  connection: PoolConnection,
  matchIds: ReadonlyArray<number>,
): Promise<Map<number, MatchMapSets>> {
  const byMatch = new Map<number, MatchMapSets>();
  if (matchIds.length === 0) return byMatch;
  const result = await connection.execute<MapRow[]>(
    `SELECT match_id, source, map_number, replay_code, team1_score, team2_score
     FROM bg_match_maps
     WHERE match_id IN (${matchIds.map(() => "?").join(", ")})
     ORDER BY match_id, source, map_number`,
    [...matchIds],
  );
  // Tolérant : un double de connexion qui ne connaît pas la table rend rien.
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
  for (const row of rows) {
    const matchId = Number(row.match_id);
    let sets = byMatch.get(matchId);
    if (!sets) {
      sets = { final: [], team1: [], team2: [] };
      byMatch.set(matchId, sets);
    }
    sets[SET_KEY[row.source]].push(toResult(row));
  }
  return byMatch;
}

function toResult(row: MapRow): MatchMapResult {
  return {
    mapNumber: Number(row.map_number),
    replayCode: String(row.replay_code),
    team1Score: Number(row.team1_score),
    team2Score: Number(row.team2_score),
  };
}
