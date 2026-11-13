/**
 * Format Duel / Arcade côté serveur (`docs/features/DUEL_ARCADE.md`) : points
 * qui gagnent une carte, lus pour la validation des scores, et verrou qui fige
 * le réglage une fois un score saisi. Règles pures : `lib/shared/map-points.ts`.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  clipMapPointTargets,
  effectiveMapPointTarget,
  effectiveMapPointTargets,
  parseStoredMapPointTarget,
  parseStoredMapPointTargets,
} from "@/lib/shared/map-points";
import type { RoundKey } from "@/lib/shared/round-maps";

/** Manche d'une ligne de match (`bg_matches`). */
export function matchRoundKey(match: { phase_id?: number | null; bracket: string; round_number: number }): RoundKey {
  return { phaseId: Number(match.phase_id ?? 0), bracket: match.bracket, roundNumber: Number(match.round_number) };
}

/** Points d'un match : N du match (tour, sinon tournoi) et N effectif carte par carte. */
export type MatchPointRules = {
  /** N du tour, sinon du tournoi ; `null` : format éteint. */
  pointTarget: number | null;
  /** N effectif des cartes réglées une à une (carte 1 en tête), `null` sans réglage carte par carte. */
  pointTargets: number[] | null;
};

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
 *
 * Coût assumé : sans ligne pour la manche (cas courant), la lecture pose un
 * verrou d'intervalle partagé, qui ne gêne que l'**insertion** d'une manche
 * voisine (cartes, départage, points) pendant la saisie. Ces écritures du staff
 * passent toutes par `retryOnDeadlock` ; une lecture simple, elle, jugerait le
 * score sur un réglage périmé (`REPEATABLE READ`), ce qu'aucun rejeu ne répare.
 *
 * Rend en plus les points réglés **carte par carte** sur le tour
 * (`map_point_targets`) : même ligne, même lecture verrouillante. Ordre de
 * résolution d'une carte : la carte, le tour, le tournoi. Limités aux cartes
 * que le match joue (`maxMaps`, comme l'instantané et le brief) : la règle qui
 * juge un score est celle que les deux portes montrent.
 */
export async function loadMatchPointRules(
  connection: PoolConnection,
  tournamentId: number,
  tournamentTarget: unknown,
  round: RoundKey,
  /** Cartes au plus d'un match du tour (`roundMaxMaps`) ; `null` : rien n'est coupé. */
  maxMaps: number | null = null,
): Promise<MatchPointRules> {
  const target = parseStoredMapPointTarget(tournamentTarget);
  if (target === null) return { pointTarget: null, pointTargets: null };
  const [rows] = await connection.execute<
    (RowDataPacket & { map_point_target: number | null; map_point_targets?: string | null })[]
  >(
    `SELECT map_point_target, map_point_targets FROM bg_tournament_round_maps
      WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ? LIMIT 1
      LOCK IN SHARE MODE`,
    [tournamentId, round.phaseId, round.bracket, round.roundNumber],
  );
  const own = parseStoredMapPointTarget(rows[0]?.map_point_target);
  const pointTarget = effectiveMapPointTarget(target, own === null ? [] : [{ ...round, target: own }], round);
  return {
    pointTarget,
    pointTargets: effectiveMapPointTargets(
      pointTarget,
      clipMapPointTargets(parseStoredMapPointTargets(rows[0]?.map_point_targets), maxMaps),
    ),
  };
}

/**
 * Refuse (`MAP_POINTS_LOCKED`) de changer les points par carte quand un match
 * concerné est **jouable** et porte déjà un score — score retenu, proposition
 * d'engagé ou cartes saisies (`bg_match_maps`, arbitrage compris) — ou a déjà
 * ouvert son lancement (`lobby_opened_at` / `launched_at`) : la règle
 * changerait sous un score déjà jugé par l'ancienne, ou sous un match que les
 * équipes jouent avec la règle annoncée (brief du salon). Concerné : les
 * matchs de la manche `round`, ou de tout le tournoi sans manche. Une
 * exemption (`is_bye`, place vide) ou un match fantôme (deux places vides),
 * clos d'office par le moteur, ne fige rien : personne n'y marque de point.
 *
 * À appeler **sous le verrou du tournoi** (`FOR UPDATE`, première
 * instruction). Les matchs concernés sont verrouillés à leur tour — ordre
 * tournoi puis matchs, celui du moteur — pour qu'un report en cours sur l'un
 * d'eux soit attendu puis vu, plutôt que manqué ; les cartes se relisent en
 * lecture verrouillante (`LOCK IN SHARE MODE`), qui voit la dernière écriture
 * commitée plutôt que l'image figée de la transaction. Requêtes sans jointure
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
      team1_id: number | null;
      team2_id: number | null;
      is_bye: number | boolean | null;
      team1_score: number | null;
      team2_score: number | null;
      team1_reported_at: Date | null;
      team2_reported_at: Date | null;
      lobby_opened_at: Date | null;
      launched_at: Date | null;
    })[]
  >(
    `SELECT id, team1_id, team2_id, is_bye, team1_score, team2_score, team1_reported_at, team2_reported_at,
            lobby_opened_at, launched_at
       FROM bg_matches
      WHERE tournament_id = ?${scope.sql} FOR UPDATE`,
    [tournamentId, ...scope.params],
  );
  const playable = matches.filter(
    (match) => match.team1_id !== null && match.team2_id !== null && !Number(match.is_bye ?? 0),
  );
  if (playable.length === 0) return;
  const locked = (match: (typeof playable)[number]) =>
    match.team1_score !== null || match.team2_score !== null
    || match.team1_reported_at !== null || match.team2_reported_at !== null
    || match.lobby_opened_at !== null || match.launched_at !== null;
  if (playable.some(locked)) {
    throw new Error("MAP_POINTS_LOCKED");
  }
  const ids = playable.map((match) => Number(match.id));
  const [maps] = await connection.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_match_maps WHERE match_id IN (${ids.map(() => "?").join(", ")}) LIMIT 1 LOCK IN SHARE MODE`,
    ids,
  );
  if (maps.length > 0) throw new Error("MAP_POINTS_LOCKED");
}
