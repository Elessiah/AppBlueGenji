/**
 * BlueGenji Survie — avancement des manches qualificatives lu en base : saisies
 * déjà portées, manche close, appariements périmés (`docs/features/BG_SURVIE_MODE.md`).
 */

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pairingsAreStale } from "@/lib/shared/bg-survie/pairing-staleness";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { planEnduranceRound, type EnduranceStanding } from "@/lib/shared/bg-survie/standings";

/**
 * « Ce match porte une saisie » — le prédicat de `match-lock` en SQL.
 *
 * Écrit une seule fois : trois lectures s'en servent (réappariement d'une
 * manche périmée, verrou du retrait d'une pénalité, et la borne que l'interface
 * reçoit pour ne pas proposer un geste que le serveur refusera). Trois copies
 * divergeraient au premier réglage, et l'interface offrirait alors un bouton
 * voué au 409.
 */
const HAS_SCORE_INPUT_SQL = `(team1_score IS NOT NULL OR team2_score IS NOT NULL
            OR winner_team_id IS NOT NULL OR forfeit_team_id IS NOT NULL
            OR double_forfeit = 1 OR status = 'AWAITING_CONFIRMATION')`;

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

/**
 * Une manche **postérieure** à `round` porte-t-elle déjà une saisie ?
 *
 * C'est la règle de `lib/shared/match-lock.ts` appliquée aux sanctions : en
 * survie, sans lien de bracket, toute manche ultérieure dépend des
 * précédentes — leurs appariements se recalculent depuis le classement. Une
 * pénalité retirée derrière une manche déjà jouée remettrait donc une équipe
 * en lice sans que les manches qu'elle a manquées soient réappariées : elle
 * rentrerait avec un capital intact devant celles qui ont réellement joué.
 *
 * Le `>` est strict : la manche de la sanction elle-même peut être entamée,
 * la pénalité tombe de toute façon **après** ses matchs.
 */
export async function laterRoundHasScoreInput(
  conn: PoolConnection,
  tournamentId: number,
  round: number,
): Promise<boolean> {
  const [rows] = await conn.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number > ?
       AND round_number < ?
       AND ${HAS_SCORE_INPUT_SQL}`,
    [tournamentId, round, PLAYOFF_ROUND_OFFSET],
  );
  return Number(rows[0]?.c ?? 0) > 0;
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
