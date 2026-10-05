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
  await connection.execute(`DELETE FROM bg_match_maps WHERE match_id = ? AND source = ?`, [matchId, source]);
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
 * report seul à l'échéance du délai). Les propositions sont effacées dans la
 * foulée : `finalizeMatch` vient d'effacer leurs colonnes de score.
 */
export async function promoteReportedMaps(
  connection: PoolConnection,
  matchId: number,
  from: "TEAM1" | "TEAM2",
): Promise<void> {
  await connection.execute(`DELETE FROM bg_match_maps WHERE match_id = ? AND source = 'FINAL'`, [matchId]);
  await connection.execute(
    `INSERT INTO bg_match_maps
       (match_id, source, map_number, replay_code, team1_score, team2_score, submitted_by_user_id, submitted_at)
     SELECT match_id, 'FINAL', map_number, replay_code, team1_score, team2_score, submitted_by_user_id, submitted_at
     FROM bg_match_maps
     WHERE match_id = ? AND source = ?`,
    [matchId, from],
  );
  await connection.execute(
    `DELETE FROM bg_match_maps WHERE match_id = ? AND source IN ('TEAM1', 'TEAM2')`,
    [matchId],
  );
}

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
