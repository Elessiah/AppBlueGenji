import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { MatchRow } from "./_internal";

async function pushTeamToTarget(
  connection: PoolConnection,
  targetMatchId: number | null,
  targetSlot: number | null,
  teamId: number | null,
): Promise<void> {
  if (!targetMatchId || !targetSlot || !teamId) return;

  if (targetSlot === 1) {
    await connection.execute(`UPDATE bg_matches SET team1_id = ? WHERE id = ?`, [
      teamId,
      targetMatchId,
    ]);
  } else {
    await connection.execute(`UPDATE bg_matches SET team2_id = ? WHERE id = ?`, [
      teamId,
      targetMatchId,
    ]);
  }

  const [rows] = await connection.execute<
    (RowDataPacket & { team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT team1_id, team2_id
     FROM bg_matches
     WHERE id = ?
     LIMIT 1`,
    [targetMatchId],
  );

  const row = rows[0];
  const nextStatus =
    row.team1_id !== null && row.team2_id !== null ? "READY" : "PENDING";

  await connection.execute(`UPDATE bg_matches SET status = ? WHERE id = ?`, [
    nextStatus,
    targetMatchId,
  ]);
}

async function finalizeMatch(
  connection: PoolConnection,
  tournamentId: number,
  match: Pick<
    MatchRow,
    | "id"
    | "team1_id"
    | "team2_id"
    | "next_winner_match_id"
    | "next_winner_slot"
    | "next_loser_match_id"
    | "next_loser_slot"
  >,
  result: {
    team1Score: number | null;
    team2Score: number | null;
    winnerTeamId: number | null;
    loserTeamId: number | null;
  },
): Promise<void> {
  await connection.execute(
    `UPDATE bg_matches
     SET team1_score = ?,
         team2_score = ?,
         winner_team_id = ?,
         loser_team_id = ?,
         status = 'COMPLETED',
         team1_report_score = NULL,
         team1_report_opponent_score = NULL,
         team1_reported_at = NULL,
         team2_report_score = NULL,
         team2_report_opponent_score = NULL,
         team2_reported_at = NULL,
         score_deadline_at = NULL
     WHERE id = ?`,
    [
      result.team1Score,
      result.team2Score,
      result.winnerTeamId,
      result.loserTeamId,
      match.id,
    ],
  );

  await pushTeamToTarget(
    connection,
    match.next_winner_match_id === null ? null : Number(match.next_winner_match_id),
    match.next_winner_slot === null ? null : Number(match.next_winner_slot),
    result.winnerTeamId,
  );

  await pushTeamToTarget(
    connection,
    match.next_loser_match_id === null ? null : Number(match.next_loser_match_id),
    match.next_loser_slot === null ? null : Number(match.next_loser_slot),
    result.loserTeamId,
  );
}

/**
 * Un match n'a plus d'alimentation en attente sur une case quand aucun match
 * non terminé du même plateau n'y envoie son vainqueur ou son perdant.
 *
 * Posée dans la requête des candidats plutôt qu'en un `COUNT(*)` par candidat :
 * au lancement d'une double élimination à 128 équipes, ~200 matchs ont une
 * case vide, et chaque comptage était un aller-retour de plus dans la
 * transaction du score. `slotSql` désigne la case attendue (`null` = l'une ou
 * l'autre, pour un match fantôme).
 */
function noPendingFeederSql(slotSql: string | null): string {
  const winnerSlot = slotSql === null ? "" : ` AND f.next_winner_slot = ${slotSql}`;
  const loserSlot = slotSql === null ? "" : ` AND f.next_loser_slot = ${slotSql}`;
  return `NOT EXISTS (
          SELECT 1
          FROM bg_matches f
          WHERE f.tournament_id = m.tournament_id
            AND f.phase_id = m.phase_id
            AND f.status <> 'COMPLETED'
            AND (
              (f.next_winner_match_id = m.id${winnerSlot})
              OR
              (f.next_loser_match_id = m.id${loserSlot})
            )
        )`;
}

/**
 * Exemption que `tryAutoResolveByes` trancherait **tout de suite** : match
 * ouvert, une seule équipe présente, et plus aucun match non terminé
 * n'alimente la case vide. Porte sur l'alias `m` de `bg_matches`.
 *
 * Exportée pour `findDueMaintenance` (`./sync-scope`), qui doit poser
 * **exactement** la même question : une clause plus large — « une case est
 * vide » — y attrapait toute case qui attend le vainqueur d'un match non joué,
 * situation normale de tout arbre en cours, et faisait entretenir à chaque
 * balayage des tournois où la résolution n'avait rien à faire.
 */
export const RESOLVABLE_BYE_SQL = `(m.status <> 'COMPLETED'
        AND m.winner_team_id IS NULL
        AND ((m.team1_id IS NULL AND m.team2_id IS NOT NULL) OR (m.team1_id IS NOT NULL AND m.team2_id IS NULL))
        AND ${noPendingFeederSql("CASE WHEN m.team1_id IS NULL THEN 1 ELSE 2 END")})`;

/**
 * Match fantôme que `tryAutoResolveByes` clôturerait tout de suite : aucune
 * équipe, et plus aucun match non terminé ne l'alimente. Même contrat que
 * `RESOLVABLE_BYE_SQL`.
 */
export const RESOLVABLE_GHOST_SQL = `(m.status <> 'COMPLETED'
        AND m.winner_team_id IS NULL
        AND m.team1_id IS NULL
        AND m.team2_id IS NULL
        AND ${noPendingFeederSql(null)})`;

/**
 * Tranche d'office ce que le plateau ne peut plus disputer : exemptions (une
 * seule équipe, case vide sans alimentation en attente) et matchs fantômes
 * (aucune équipe). Chaque passe lit ses candidats **une fois**, alimentation
 * comprise ; ce qu'une résolution débloque est repris à la passe suivante —
 * jamais sur la ligne déjà lue, dont la case vide a pu être garnie entre-temps.
 */
export async function tryAutoResolveByes(
  connection: PoolConnection,
  tournamentId: number,
  phaseId = 0,
): Promise<void> {
  let hasProgress = true;

  while (hasProgress) {
    hasProgress = false;

    // Cas 1 : exactement une équipe présente, le slot vide n'a plus de feeder en attente → BYE win
    // Les byes ne doivent jamais s'échapper d'une phase vers une autre.
    const [candidates] = await connection.execute<MatchRow[]>(
      `SELECT
        m.id,
        m.team1_id,
        m.team2_id,
        m.next_winner_match_id,
        m.next_winner_slot,
        m.next_loser_match_id,
        m.next_loser_slot
      FROM bg_matches m
      WHERE m.tournament_id = ?
        AND m.phase_id = ?
        AND ${RESOLVABLE_BYE_SQL}`,
      [tournamentId, phaseId],
    );

    for (const candidate of candidates) {
      const winnerTeamId =
        candidate.team1_id === null ? Number(candidate.team2_id) : Number(candidate.team1_id);
      const score =
        candidate.team1_id === null ? { team1: 0, team2: 1 } : { team1: 1, team2: 0 };

      await finalizeMatch(connection, tournamentId, candidate, {
        team1Score: score.team1,
        team2Score: score.team2,
        winnerTeamId,
        loserTeamId: null,
      });

      hasProgress = true;
    }

    // Cas 2 : les deux slots sont vides (match fantôme)
    const [ghosts] = await connection.execute<MatchRow[]>(
      `SELECT m.id
       FROM bg_matches m
       WHERE m.tournament_id = ?
         AND m.phase_id = ?
         AND ${RESOLVABLE_GHOST_SQL}`,
      [tournamentId, phaseId],
    );

    if (ghosts.length > 0) {
      const ids = ghosts.map((ghost) => Number(ghost.id));
      await connection.execute(
        `UPDATE bg_matches
         SET status = 'COMPLETED',
             team1_score = 0,
             team2_score = 0
         WHERE id IN (${ids.map(() => "?").join(", ")})`,
        ids,
      );

      hasProgress = true;
    }
  }
}
