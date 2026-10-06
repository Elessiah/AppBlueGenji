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
  submitted_by_user_id?: number | null;
  submitted_at?: Date | string | null;
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
 * Efface un jeu de maps **s'il existe**.
 *
 * La lecture est **verrouillante** (`FOR UPDATE`, table seule — MariaDB) : une
 * lecture cohérente lirait l'instantané pris au début de la transaction, avant
 * le verrou du match, et manquerait les lignes qu'un report concurrent du même
 * match vient de valider — l'insertion qui suit heurterait alors la clé unique.
 * Sur un intervalle vide, elle pose un verrou d'intervalle comme le ferait le
 * `DELETE` : deux reports simultanés sur des matchs voisins peuvent alors
 * s'interbloquer, ce que le report d'un engagé rattrape en rejouant sa
 * transaction (`reportMatchScorePublic`).
 */
async function clearMatchMaps(connection: PoolConnection, matchId: number, source: MatchMapSource): Promise<void> {
  const result = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_maps WHERE match_id = ? AND source = ? LIMIT 1 FOR UPDATE`,
    [matchId, source],
  );
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
  if (rows.length === 0) return;
  await connection.execute(`DELETE FROM bg_match_maps WHERE match_id = ? AND source = ?`, [matchId, source]);
}

/**
 * Maps d'un jeu précis, dans l'ordre joué. Lecture verrouillante : elle voit
 * la proposition qu'un report concurrent vient de valider (voir
 * `clearMatchMaps`), sans quoi la comparaison des deux propositions la
 * prendrait pour un report d'avant les maps.
 */
export async function loadMatchMaps(
  connection: PoolConnection,
  matchId: number,
  source: MatchMapSource,
): Promise<MatchMapResult[]> {
  const [rows] = await connection.execute<MapRow[]>(
    `SELECT match_id, source, map_number, replay_code, team1_score, team2_score
     FROM bg_match_maps
     WHERE match_id = ? AND source = ?
     ORDER BY map_number
     FOR UPDATE`,
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
  options: { locking?: boolean } = {},
): Promise<void> {
  const lock = options.locking === false ? "" : " FOR UPDATE";
  // Rien à promouvoir, rien à effacer : une clôture concurrente du même report
  // expiré (l'entretien tourne à chaque écriture et à chaque chargement) a déjà
  // promu la proposition puis l'a effacée. Sans cette garde, la seconde
  // effaçait le détail retenu par la première sans rien remettre.
  //
  // La proposition est lue **en entier** puis réécrite par `VALUES` : un
  // `INSERT … SELECT` sur la table elle-même verrouillerait les lignes lues et
  // leurs intervalles, même en mode « sans verrou » (`locking: false`, celui
  // de l'entretien, qui ne rejoue pas sa transaction).
  const pending = await connection.execute<MapRow[]>(
    `SELECT match_id, source, map_number, replay_code, team1_score, team2_score, submitted_by_user_id, submitted_at
     FROM bg_match_maps WHERE match_id = ? AND source = ?
     ORDER BY map_number${lock}`,
    [matchId, from],
  );
  const rows = Array.isArray(pending) && Array.isArray(pending[0]) ? pending[0] : [];
  if (rows.length === 0) return;
  // Écrasement **par la clé unique** plutôt qu'un effacement préalable : un
  // `FINAL` qu'un arbitre vient de valider sur ce match peut échapper à
  // l'instantané de la transaction (pris avant le verrou du match), et une
  // insertion simple heurterait alors `uq_bg_match_maps_slot` — un 500 qu'aucun
  // rejeu ne rattrape. `ON DUPLICATE KEY UPDATE` voit la dernière version.
  await connection.execute(
    `INSERT INTO bg_match_maps
       (match_id, source, map_number, replay_code, team1_score, team2_score, submitted_by_user_id, submitted_at)
     VALUES ${rows.map(() => "(?, 'FINAL', ?, ?, ?, ?, ?, ?)").join(", ")}
     ON DUPLICATE KEY UPDATE
       replay_code = VALUES(replay_code),
       team1_score = VALUES(team1_score),
       team2_score = VALUES(team2_score),
       submitted_by_user_id = VALUES(submitted_by_user_id),
       submitted_at = VALUES(submitted_at)`,
    rows.flatMap((row) => [
      matchId,
      Number(row.map_number),
      String(row.replay_code),
      Number(row.team1_score),
      Number(row.team2_score),
      row.submitted_by_user_id ?? null,
      row.submitted_at ?? new Date(),
    ]),
  );
  // Un `FINAL` plus long que la proposition garderait des maps en trop :
  // effacées si une lecture sans verrou en voit (pas de verrou d'intervalle sur
  // l'entretien, qui ne rejoue pas). Un reste invisible à l'instantané ne
  // s'afficherait pas : le détail ne s'affiche que s'il explique le score.
  const extra = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_maps WHERE match_id = ? AND source = 'FINAL' AND map_number > ? LIMIT 1`,
    [matchId, rows.length],
  );
  const extraRows = Array.isArray(extra) && Array.isArray(extra[0]) ? extra[0] : [];
  if (extraRows.length > 0) {
    await connection.execute(
      `DELETE FROM bg_match_maps WHERE match_id = ? AND source = 'FINAL' AND map_number > ?`,
      [matchId, rows.length],
    );
  }
}

/**
 * Efface des jeux de maps sur plusieurs matchs, **s'il y en a**.
 *
 * Lecture **sans verrou** : ces effacements suivent la clôture, l'abandon ou le
 * retour en arrière d'un match — chemins qui ne rejouent pas leur transaction
 * sur interblocage, et où un verrou d'intervalle sur une plage vide (le cas
 * ordinaire : pas de proposition) en ferait naître. Le seul angle mort — une
 * proposition validée par un report concurrent après l'instantané de la
 * transaction — laisse une ligne orpheline que l'affichage tait (plus de
 * colonnes de report) et que la clôture suivante du match emporte.
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

/** Tout le détail d'un match : propositions et résultat retenu. */
export const ALL_MAP_SOURCES: ReadonlyArray<MatchMapSource> = ["TEAM1", "TEAM2", "FINAL"];

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
