/**
 * Format Duel / Arcade côté serveur (`docs/features/DUEL_ARCADE.md`) : points
 * qui gagnent une carte, lus pour la validation des scores, et verrou qui fige
 * le réglage une fois un score saisi. Règles pures : `lib/shared/map-points.ts`.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { effectiveMapPointTarget, parseStoredMapPointTarget } from "@/lib/shared/map-points";
import type { RoundKey } from "@/lib/shared/round-maps";

/** Manche d'une ligne de match (`bg_matches`). */
export function matchRoundKey(match: { phase_id?: number | null; bracket: string; round_number: number }): RoundKey {
  return { phaseId: Number(match.phase_id ?? 0), bracket: match.bracket, roundNumber: Number(match.round_number) };
}

/**
 * Points qui gagnent une carte d'un match de la manche `round`, le N du
 * tournoi étant déjà lu (`tournamentTarget`) : rien à relire quand le format
 * est éteint, sinon le réglage propre au tour s'il en a un.
 *
 * Le réglage du tour se lit en **lecture verrouillante** (`LOCK IN SHARE MODE`,
 * syntaxe admise par MariaDB) : il reste modifiable en plein tournoi
 * (`setRoundPointTarget`), et une saisie dont la transaction a déjà figé son
 * image (lecture simple plus tôt, `REPEATABLE READ`) jugerait sinon le score
 * sur l'ancienne valeur après avoir attendu le verrou du match — puis
 * l'enregistrerait sous la nouvelle. La lecture verrouillante voit la valeur
 * commitée ; l'ordre inverse (match puis réglage, contre tournoi puis matchs
 * pour `setRoundPointTarget`) peut s'interbloquer, ce que `retryOnDeadlock`
 * rejoue sur tous les chemins de saisie. Le N du tournoi, lui, n'est plus
 * modifiable une fois des matchs créés (fenêtre `LOCKED`).
 */
export async function loadMatchPointTarget(
  connection: PoolConnection,
  tournamentId: number,
  tournamentTarget: unknown,
  round: RoundKey,
): Promise<number | null> {
  const target = parseStoredMapPointTarget(tournamentTarget);
  if (target === null) return null;
  const [rows] = await connection.execute<(RowDataPacket & { map_point_target: number | null })[]>(
    `SELECT map_point_target FROM bg_tournament_round_maps
      WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ? LIMIT 1
      LOCK IN SHARE MODE`,
    [tournamentId, round.phaseId, round.bracket, round.roundNumber],
  );
  const own = parseStoredMapPointTarget(rows[0]?.map_point_target);
  return effectiveMapPointTarget(target, own === null ? [] : [{ ...round, target: own }], round);
}

/**
 * Refuse (`MAP_POINTS_LOCKED`) de changer les points par carte quand un match
 * concerné porte déjà un score — score retenu, proposition d'engagé ou cartes
 * saisies (`bg_match_maps`, arbitrage compris) : la règle changerait sous un
 * score déjà jugé par l'ancienne. Concerné : les matchs de la manche `round`,
 * ou de tout le tournoi sans manche.
 *
 * À appeler **sous le verrou du tournoi** (`FOR UPDATE`, première
 * instruction). Les matchs concernés sont verrouillés à leur tour — ordre
 * tournoi puis matchs, celui du moteur — pour qu'un report en cours sur l'un
 * d'eux soit attendu puis vu, plutôt que manqué. Requêtes sans jointure
 * (MariaDB, `CLAUDE.md`).
 */
export async function assertMapPointsUnlocked(
  connection: PoolConnection,
  tournamentId: number,
  round: RoundKey | null,
): Promise<void> {
  const scope = round
    ? { sql: " AND phase_id = ? AND bracket = ? AND round_number = ?", params: [round.phaseId, round.bracket, round.roundNumber] }
    : { sql: "", params: [] };
  const [matches] = await connection.execute<
    (RowDataPacket & {
      id: number;
      team1_score: number | null;
      team2_score: number | null;
      team1_reported_at: Date | null;
      team2_reported_at: Date | null;
    })[]
  >(
    `SELECT id, team1_score, team2_score, team1_reported_at, team2_reported_at FROM bg_matches
      WHERE tournament_id = ?${scope.sql} FOR UPDATE`,
    [tournamentId, ...scope.params],
  );
  if (matches.length === 0) return;
  const scored = (match: (typeof matches)[number]) =>
    match.team1_score !== null || match.team2_score !== null
    || match.team1_reported_at !== null || match.team2_reported_at !== null;
  if (matches.some(scored)) {
    throw new Error("MAP_POINTS_LOCKED");
  }
  const [maps] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_maps
      WHERE match_id IN (SELECT id FROM bg_matches WHERE tournament_id = ?${scope.sql}) LIMIT 1`,
    [tournamentId, ...scope.params],
  );
  if (maps.length > 0) throw new Error("MAP_POINTS_LOCKED");
}
