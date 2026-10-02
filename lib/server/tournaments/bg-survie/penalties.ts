/**
 * BlueGenji Survie — `applyEndurancePenalty` / `liftEndurancePenalty` :
 * sanction d'arbitrage sur le capital d'endurance
 * (`lib/shared/endurance-penalty.ts`, `docs/features/ENDURANCE_PENALTIES.md`).
 * Elles n'écrivent **que** la table des pénalités, puis laissent le rejeu en
 * tirer les conséquences : aucune des deux ne touche au classement.
 */

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isMissingTableError, rowsOrEmptyIfMissingTable } from "@/lib/server/mysql-errors";
import { checkEndurancePenalty, normalizePenaltyReason } from "@/lib/shared/endurance-penalty";
import { reconcileEndurance } from "./reconcile";
import { laterRoundHasScoreInput } from "./round-progress";
import { loadTournament } from "./tournament-row";

/**
 * Inflige une pénalité d'endurance à un engagé, puis rejoue le tournoi.
 *
 * **Réservé à la phase qualificative**, et pour la même raison que l'abandon :
 * le capital d'endurance ne décide plus rien une fois l'arbre lancé — une
 * sanction y serait sans effet, mais figurerait quand même au tableau comme si
 * elle en avait un.
 *
 * La manche portée par la sanction est la **manche courante** : c'est ce qui la
 * situe dans la chronologie. Elle pèse donc sur l'appariement de la suivante,
 * et `reconcileEndurance` réapparie de lui-même une manche déjà posée mais
 * jamais jouée — exactement comme après une correction de score.
 *
 * **Sur un tournoi en cours seulement**, comme l'abandon en Survie et en Ronde
 * suisse. Depuis que la réconciliation rejoue aussi les tournois clos, une
 * sanction tardive ne serait plus muette — elle serait pire : elle réécrirait un
 * palmarès **déjà publié**, sans qu'aucune manche ne puisse plus être jouée pour
 * en répondre. Corriger le score d'une archive répare une erreur d'arbitrage ;
 * la sanctionner après coup en crée une. Le cas est atteignable : un tournoi
 * clos par `startEndurancePlayoffs` faute de qualifiées garde
 * `endurance_playoffs_started` à 0.
 *
 * @throws NOT_BG_SURVIE | TOURNAMENT_NOT_RUNNING | ENDURANCE_PLAYOFFS_STARTED
 *         | TEAM_NOT_IN_TOURNAMENT | TEAM_ALREADY_OUT | INVALID_PENALTY
 */
export async function applyEndurancePenalty(
  tournamentId: number,
  teamId: number,
  points: number,
  reason: string,
  authorId: number | null,
  conn: PoolConnection,
): Promise<{ reason: string }> {
  const tournament = await loadTournament(conn, tournamentId, true);
  if (tournament?.format !== "BG_SURVIE") throw new Error("NOT_BG_SURVIE");
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
  if (Number(tournament.endurance_playoffs_started) === 1) {
    throw new Error("ENDURANCE_PLAYOFFS_STARTED");
  }

  // La même règle que le formulaire, appliquée par le même module : le serveur
  // reste le juge, l'interface n'en est que la première passe.
  if (checkEndurancePenalty(points, reason) !== null) throw new Error("INVALID_PENALTY");

  const [rows] = await conn.execute<(RowDataPacket & { status: string })[]>(
    `SELECT status FROM bg_endurance_standings WHERE tournament_id = ? AND team_id = ? LIMIT 1`,
    [tournamentId, teamId],
  );
  if (rows.length === 0) throw new Error("TEAM_NOT_IN_TOURNAMENT");
  if (rows[0].status !== "ACTIVE") throw new Error("TEAM_ALREADY_OUT");

  // Avant la première manche, la sanction porte tout de même sur la manche 1 :
  // le rejeu ne connaît pas de manche 0, et une pénalité prononcée au coup
  // d'envoi doit peser dès le premier appariement.
  const round = Math.max(Number(tournament.endurance_current_round), 1);

  // Le motif normalisé est **rendu** à l'appelant, et non renormalisé par lui :
  // la ligne du journal Discord doit porter le texte tel qu'il est stocké, sans
  // quoi le canal montrerait une espacement que la page ne montre pas.
  const normalized = normalizePenaltyReason(reason);

  // Sans la table, la sanction ne peut pas s'écrire : on le dit par un code,
  // sans quoi le message brut de MySQL (base et table nommées) partirait tel
  // quel dans la notification de l'arbitre.
  try {
    await conn.execute(
      `INSERT INTO bg_endurance_penalties
        (tournament_id, team_id, round_number, points, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tournamentId, teamId, round, Math.floor(points), normalized, authorId],
    );
  } catch (error) {
    if (isMissingTableError(error)) throw new Error("PENALTIES_UNAVAILABLE");
    throw error;
  }

  await reconcileEndurance(tournamentId, conn);

  return { reason: normalized };
}

/**
 * Retire une pénalité, puis rejoue le tournoi.
 *
 * C'est **la** façon de corriger une sanction saisie de travers : le rejeu
 * défait le retrait de points et tout ce qu'il a entraîné — l'élimination qu'il
 * avait provoquée, la coupe sous plafond qui en découlait, l'appariement de la
 * manche suivante tant qu'elle n'est pas entamée. Une seconde pénalité de sens
 * inverse ne saurait pas faire cela, et laisserait au classement deux sanctions
 * dont l'une est un pansement.
 *
 * Refusé une fois l'arbre lancé, comme l'est l'application : le rejeu rendrait
 * ses points à l'équipe, et pourrait la ramener « en lice » alors que le
 * plateau des play-offs est déjà tiré sans elle — un classement qui contredit
 * l'arbre affiché juste au-dessus. La sanction devient donc définitive au même
 * instant que le capital cesse de décider quoi que ce soit.
 *
 * Refusé **aussi** dès qu'une manche postérieure porte une saisie
 * (`ENDURANCE_ROUND_ALREADY_PLAYED`) : c'est la règle de `match-lock`, que le
 * retrait est le seul geste du mode à pouvoir enfreindre puisqu'il remonte le
 * temps. Sans elle, lever une sanction de la manche 2 à la manche 7 rendrait
 * son capital **intact** à une équipe qui n'a pas joué les quatre manches
 * entre-temps — le rejeu ne réapparie que la manche courante, les autres
 * restent telles qu'elles ont été jouées, et l'équipe ressuscitée passerait
 * devant toutes celles qui y ont perdu des maps.
 *
 * @throws NOT_BG_SURVIE | TOURNAMENT_NOT_RUNNING | ENDURANCE_PLAYOFFS_STARTED
 *         | ENDURANCE_ROUND_ALREADY_PLAYED | PENALTY_NOT_FOUND
 */
export async function liftEndurancePenalty(
  tournamentId: number,
  penaltyId: number,
  conn: PoolConnection,
): Promise<{ teamId: number; points: number }> {
  const tournament = await loadTournament(conn, tournamentId, true);
  if (tournament?.format !== "BG_SURVIE") throw new Error("NOT_BG_SURVIE");
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
  if (Number(tournament.endurance_playoffs_started) === 1) {
    throw new Error("ENDURANCE_PLAYOFFS_STARTED");
  }

  // La pénalité est relue **par son tournoi** : un identifiant de sanction
  // appartenant à un autre plateau ne doit pas s'effacer depuis cette page.
  // Sans la table, aucune sanction n'existe : l'identifiant est introuvable
  // (404), pas une panne du serveur.
  const rows = await rowsOrEmptyIfMissingTable(
    conn.execute<(RowDataPacket & { team_id: number; points: number; round_number: number })[]>(
      `SELECT team_id, points, round_number FROM bg_endurance_penalties
       WHERE id = ? AND tournament_id = ? LIMIT 1`,
      [penaltyId, tournamentId],
    ),
  );
  if (rows.length === 0) throw new Error("PENALTY_NOT_FOUND");

  if (await laterRoundHasScoreInput(conn, tournamentId, Number(rows[0].round_number))) {
    throw new Error("ENDURANCE_ROUND_ALREADY_PLAYED");
  }

  await conn.execute(`DELETE FROM bg_endurance_penalties WHERE id = ? AND tournament_id = ?`, [
    penaltyId,
    tournamentId,
  ]);

  await reconcileEndurance(tournamentId, conn);

  return { teamId: Number(rows[0].team_id), points: Number(rows[0].points) };
}
