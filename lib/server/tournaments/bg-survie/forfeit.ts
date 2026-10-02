/**
 * BlueGenji Survie — abandon d'une équipe pour le reste du tournoi (`docs/features/BG_SURVIE_MODE.md`).
 */

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { forfeitMapCount } from "@/lib/shared/match-format";
import { reconcileEndurance } from "./reconcile";
import { loadTournament, matchFormatOf } from "./tournament-row";

/**
 * Déclare l'abandon d'une équipe : elle quitte le tournoi et son capital tombe
 * à 0. Le classement est ensuite rejoué (l'abandon est une entrée du rejeu).
 *
 * **Réservé à la phase qualificative.** Cette fonction ne sait clore qu'un match
 * de la manche courante (`endurance_current_round`) ; l'arbre final vit à partir
 * de `PLAYOFF_ROUND_OFFSET`, hors de sa portée. Laisser passer un abandon en
 * play-offs marquerait l'équipe `FORFEIT` au classement tout en la laissant
 * engagée dans un match ouvert que rien ne viendrait clore — et le rejeu
 * daterait l'abandon d'une manche qualificative qu'elle avait en réalité jouée.
 * Un forfait de play-off se tranche sur le match lui-même (`adminResolveMatch`
 * avec `forfeitTeamId`), qui fait avancer l'arbre.
 *
 * **Et à un tournoi en cours**, comme `forfeitSurvivalTeam` et
 * `forfeitSwissTeam`. La garde manquait au seul mode endurance, et le cas est
 * atteignable : un tournoi clos par `startEndurancePlayoffs` faute de qualifiées
 * garde `endurance_playoffs_started` à 0, si bien que le contrôle suivant le
 * laissait passer. L'abandon s'écrivait alors sur une archive — statut
 * `FORFEIT`, capital à 0, manche courante close — pour un tournoi que plus
 * personne ne joue. L'interface refusait déjà (`canForfeitTeam` exige
 * `RUNNING`) ; il n'y avait que le serveur à convaincre.
 *
 * @throws NOT_BG_SURVIE | TOURNAMENT_NOT_RUNNING | ENDURANCE_PLAYOFFS_STARTED
 *         | TEAM_NOT_IN_TOURNAMENT | TEAM_ALREADY_OUT
 */
export async function forfeitEnduranceTeam(
  tournamentId: number,
  teamId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId, true);
  if (tournament?.format !== "BG_SURVIE") throw new Error("NOT_BG_SURVIE");
  // Avant le contrôle des play-offs, comme en Survie et en Ronde suisse : sur un
  // tournoi clos, « le tournoi n'est pas en cours » est le vrai motif, et il
  // reste juste dans le cas que le contrôle suivant ne voit pas — un tournoi
  // fini faute de qualifiées garde `endurance_playoffs_started` à 0.
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
  if (Number(tournament.endurance_playoffs_started) === 1) {
    throw new Error("ENDURANCE_PLAYOFFS_STARTED");
  }

  const [rows] = await conn.execute<(RowDataPacket & { status: string })[]>(
    `SELECT status FROM bg_endurance_standings WHERE tournament_id = ? AND team_id = ? LIMIT 1`,
    [tournamentId, teamId],
  );
  if (rows.length === 0) throw new Error("TEAM_NOT_IN_TOURNAMENT");
  if (rows[0].status !== "ACTIVE") throw new Error("TEAM_ALREADY_OUT");

  const currentRound = Math.max(Number(tournament.endurance_current_round), 1);

  await conn.execute(
    `UPDATE bg_endurance_standings
     SET status = 'FORFEIT', points = 0, eliminated_round = ?
     WHERE tournament_id = ? AND team_id = ?`,
    [currentRound, tournamentId, teamId],
  );

  // Clôt le match en cours de l'équipe partie, sans quoi la manche ne pourrait
  // plus se terminer et la suivante ne serait jamais appariée. Le match est
  // marqué forfait et porte le score plein du format du tournoi (FT3 → 3-0) :
  // le rejeu en tire le barème d'endurance, et l'affichage montre la même chose
  // qu'une rencontre réellement gagnée sur ce score.
  const [pending] = await conn.execute<
    (RowDataPacket & { id: number; team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT id, team1_id, team2_id FROM bg_matches
     WHERE tournament_id = ? AND phase_id = 0 AND round_number = ?
       AND status <> 'COMPLETED' AND (team1_id = ? OR team2_id = ?)
     LIMIT 1`,
    [tournamentId, currentRound, teamId, teamId],
  );

  if (pending.length > 0) {
    const match = pending[0];
    const opponentId = Number(match.team1_id) === teamId ? match.team2_id : match.team1_id;
    const team1IsForfeit = Number(match.team1_id) === teamId;
    const wonMaps = forfeitMapCount(matchFormatOf(tournament));

    await conn.execute(
      `UPDATE bg_matches SET
        status = 'COMPLETED',
        winner_team_id = ?,
        loser_team_id = ?,
        forfeit_team_id = ?,
        team1_score = ?,
        team2_score = ?
       WHERE id = ?`,
      [
        opponentId,
        teamId,
        teamId,
        team1IsForfeit ? 0 : wonMaps,
        team1IsForfeit ? wonMaps : 0,
        match.id,
      ],
    );
  }

  await reconcileEndurance(tournamentId, conn);
}
