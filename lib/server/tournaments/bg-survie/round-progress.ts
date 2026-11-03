/**
 * BlueGenji Survie — avancement des manches qualificatives lu en base : saisies
 * déjà portées, manche close, appariements périmés (`docs/features/BG_SURVIE_MODE.md`).
 */

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pairingsAreStale } from "@/lib/shared/bg-survie/pairing-staleness";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { planEnduranceRound, type EnduranceStanding } from "@/lib/shared/bg-survie/standings";

/**
 * « Ce match porte une saisie » — le prédicat de `match-lock` (`hasScoreInput`,
 * `lib/shared/match-lock.ts`) en SQL : deux engagées en place **et** un score,
 * un vainqueur, un forfait, un double forfait ou un report en attente.
 *
 * Écrit une seule fois : toutes les lectures « une manche porte une saisie »
 * s'en servent (réappariement d'une manche périmée, verrous du retrait d'une
 * pénalité, de l'annulation d'un abandon et de la correction d'arbitrage, et
 * les bornes que l'interface reçoit pour ne pas proposer un geste que le
 * serveur refusera). Les deux engagées en place écartent l'exemption, que le
 * moteur pose d'office (score 1-0, seconde place vide) : elle ne dit pas qu'une
 * manche est entamée, et l'interface ne la compte pas.
 */
export const HAS_SCORE_INPUT_SQL = `(team1_id IS NOT NULL AND team2_id IS NOT NULL
            AND (team1_score IS NOT NULL OR team2_score IS NOT NULL
            OR winner_team_id IS NOT NULL OR forfeit_team_id IS NOT NULL
            OR double_forfeit = 1 OR status = 'AWAITING_CONFIRMATION'
            OR team1_reported_at IS NOT NULL OR team2_reported_at IS NOT NULL))`;

/** Un match de la manche porte-t-il déjà une saisie ? */
export async function roundHasScoreInput(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<boolean> {
  const [rows] = await conn.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number = ?
       AND ${HAS_SCORE_INPUT_SQL}`,
    [tournamentId, round],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

/**
 * Dernière manche qualificative portant une saisie, `0` s'il n'y en a aucune.
 *
 * C'est la borne du retrait d'une pénalité, telle que l'interface la reçoit :
 * une sanction de la manche N ne se retire plus dès qu'une manche strictement
 * postérieure a été entamée. Une seule requête pour tout le tableau, là où
 * `laterRoundHasScoreInput` en fait une par écriture.
 */
export async function lastRoundWithScoreInput(
  conn: PoolConnection,
  tournamentId: number,
): Promise<number> {
  const [rows] = await conn.execute<(RowDataPacket & { last_round: number | null })[]>(
    `SELECT MAX(round_number) AS last_round FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number < ?
       AND ${HAS_SCORE_INPUT_SQL}`,
    [tournamentId, PLAYOFF_ROUND_OFFSET],
  );
  return Number(rows[0]?.last_round ?? 0);
}

/** Manches postérieures à examiner, et la façon de les lire. */
export type LaterRoundsScope = {
  tournamentId: number;
  /** `0` hors multi-phases. */
  phaseId: number;
  /** Manche de référence, exclue (`>` strict). */
  afterRound: number;
  /** Borne haute exclue — en endurance, la première manche des phases finales. */
  beforeRound?: number;
  /**
   * Lecture **verrouillante** : un report écrit son score sous le verrou du
   * match avant d'attendre celui du tournoi, si bien qu'une lecture
   * d'instantané manque le score en cours. Verrouillées, les lignes de la plage
   * (index `idx_bg_matches_phase_round`, les seules manches postérieures, pas
   * toute la phase) font attendre ce report : la lecture voit son score une
   * fois commité, ou l'interblocage qu'il forme avec le verrou du tournoi est
   * rompu par le moteur et rejoué (`retryOnDeadlock`). Les lignes lues restent
   * verrouillées jusqu'au commit : un « Prêt » de la manche suivante attend la
   * fin du geste.
   */
  lock?: boolean;
};

/**
 * Une manche **postérieure** à `afterRound` porte-t-elle déjà une saisie ?
 *
 * C'est la règle de `lib/shared/match-lock.ts` pour les modes sans lien de
 * bracket (survie, ronde suisse, endurance) : toute manche ultérieure dépend des
 * précédentes — leurs appariements se recalculent depuis le classement. Une
 * seule implémentation pour les trois gestes qui remontent le temps : le
 * retrait d'une pénalité (une équipe rentrerait avec un capital intact devant
 * celles qui ont réellement joué), l'annulation d'un abandon et la correction
 * d'un résultat par l'arbitrage.
 *
 * Le `>` est strict : la manche de référence elle-même peut être entamée.
 */
export async function laterRoundsHaveScoreInput(
  conn: PoolConnection,
  scope: LaterRoundsScope,
): Promise<boolean> {
  const params: number[] = [scope.tournamentId, scope.phaseId, scope.afterRound];
  if (scope.beforeRound !== undefined) params.push(scope.beforeRound);
  const [rows] = await conn.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_matches
     WHERE tournament_id = ? AND phase_id = ? AND round_number > ?${
       scope.beforeRound === undefined ? "" : " AND round_number < ?"
     }
       AND ${HAS_SCORE_INPUT_SQL}
     LIMIT 1${scope.lock ? " FOR UPDATE" : ""}`,
    params,
  );
  return rows.length > 0;
}

/**
 * Une manche qualificative d'endurance **postérieure** à `round` porte-t-elle
 * une saisie ? Verrou du retrait d'une pénalité ({@link laterRoundsHaveScoreInput}).
 */
export function laterRoundHasScoreInput(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<boolean> {
  return laterRoundsHaveScoreInput(conn, {
    tournamentId,
    phaseId: 0,
    afterRound: round,
    beforeRound: PLAYOFF_ROUND_OFFSET,
    lock: true,
  });
}

/**
 * Les appariements posés pour cette manche correspondent-ils encore au
 * classement rejoué ? Comparaison sur les couples, l'ordre des sides étant
 * lui aussi dérivé du classement.
 */
export async function roundPairingsAreStale(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
  standings: EnduranceStanding[],
): Promise<boolean> {
  const [rows] = await conn.execute<
    (RowDataPacket & { team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT team1_id, team2_id FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number = ?
     ORDER BY match_number ASC`,
    [tournamentId, round],
  );
  if (rows.length === 0) return false;

  return pairingsAreStale(
    planEnduranceRound(standings).filter((pairing) => pairing.teamBId !== null),
    rows.map((row) => ({
      teamAId: row.team1_id === null ? null : Number(row.team1_id),
      teamBId: row.team2_id === null ? null : Number(row.team2_id),
    })),
  );
}

/** Vrai si tous les matchs de la manche sont terminés (0 match = manche vide). */
export async function roundIsComplete(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<boolean> {
  if (round <= 0) return true;

  const [rows] = await conn.execute<(RowDataPacket & { total: number; done: number })[]>(
    `SELECT COUNT(*) AS total, SUM(status = 'COMPLETED') AS done
     FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number = ?`,
    [tournamentId, round],
  );

  const total = Number(rows[0]?.total ?? 0);
  const done = Number(rows[0]?.done ?? 0);
  return total > 0 && total === done;
}
