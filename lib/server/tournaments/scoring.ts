import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { checkMatchScores, parseMatchFormat } from "@/lib/shared/match-format";
import { MatchRow } from "./_internal";
import { dropQueuedRefereeAlerts, queueBotLog, queueRefereeAlert } from "./bot-logs";
import { resolveUserEntrantTeamId } from "./registration";
import { syncTournamentState } from "./state";
import { tryAutoResolveByes } from "./byes";

async function pushTeamToTarget(
  connection: PoolConnection,
  targetMatchId: number | null,
  targetSlot: number | null,
  teamId: number | null,
): Promise<void> {
  if (!targetMatchId || !targetSlot || !teamId) return;

  const [beforeRows] = await connection.execute<
    (RowDataPacket & { team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT team1_id, team2_id FROM bg_matches WHERE id = ? LIMIT 1`,
    [targetMatchId],
  );
  const previousTeamId =
    targetSlot === 1 ? beforeRows[0]?.team1_id ?? null : beforeRows[0]?.team2_id ?? null;

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

  // Remplacer un engagé par un **autre** (correction d'un score amont) fait de
  // cette ligne une autre affiche : l'antenne ouverte sur l'ancienne ne vaut
  // plus, et la laisser ouverte rallumerait le bouton « Regarder le live » de
  // l'accueil vers une chaîne qui ne montre pas cette rencontre.
  // Remplir un créneau encore vide, en revanche, ne fait que matérialiser le
  // match prévu : une diffusion programmée à l'avance doit lui survivre.
  if (previousTeamId !== null && Number(previousTeamId) !== teamId) {
    await connection.execute(`UPDATE bg_matches SET live_started_at = NULL WHERE id = ?`, [
      targetMatchId,
    ]);
  }

  const [rows] = await connection.execute<
    (RowDataPacket & { team1_id: number | null; team2_id: number | null })[]
  >(
    `SELECT team1_id, team2_id FROM bg_matches WHERE id = ? LIMIT 1`,
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

export async function finalizeMatch(
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

  // Seul point de passage des matchs réellement tranchés — accord des deux
  // engagés, délai de report expiré, arbitrage. Les byes et matchs fantômes
  // passent par leurs propres écritures (`./byes`, les moteurs à classement) et
  // n'encombrent donc pas le journal.
  queueBotLog(connection, { kind: "match_finished", matchId: Number(match.id) });

  // Le même appel a pu, quelques instructions plus tôt, réserver une escalade
  // sur cette manche : `reportMatchScore` ouvre par `syncTournamentState`, dont
  // l'entretien tranche les reports expirés, puis clôt la manche si le report
  // reçu concorde. Sans ce retrait, le commit annoncerait aux arbitres qu'une
  // rencontre déjà `COMPLETED` « n'est toujours pas tranchée ».
  //
  // Retrait **en mémoire seulement** : rien à écrire ici, donc aucun verrou de
  // plus sur le chemin le plus chaud du moteur. L'effacement des lignes suit le
  // commit, dans `flushBotLogs`, sur la trace `match_finished` posée ci-dessus.
  dropQueuedRefereeAlerts(connection, Number(match.id));

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

function validateScoreValue(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("INVALID_SCORE");
  }
  if (value < 0 || value > 99) {
    throw new Error("INVALID_SCORE_RANGE");
  }
  return Math.trunc(value);
}

export async function reportMatchScore(
  connection: PoolConnection,
  tournamentId: number,
  matchId: number,
  userId: number,
  myScoreRaw: number,
  opponentScoreRaw: number,
): Promise<void> {
  const myScore = validateScoreValue(myScoreRaw);
  const opponentScore = validateScoreValue(opponentScoreRaw);

  if (myScore === opponentScore) {
    throw new Error("DRAW_NOT_ALLOWED");
  }

  const { row: tournament } = await syncTournamentState(connection, tournamentId);
  if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
  if (tournament.state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");

  // L'engagé dépend du tournoi : l'équipe active du joueur, ou lui-même en
  // tournoi individuel.
  const reporterTeamId = await resolveUserEntrantTeamId(connection, tournament, userId);
  if (reporterTeamId === null) {
    throw new Error("NO_ACTIVE_TEAM");
  }

  // Un report d'équipe désigne toujours un vainqueur (l'égalité est déjà
  // refusée) : le score doit donc respecter l'objectif du format — 3 manches en
  // BO5 comme en FT3 — et non seulement son plafond.
  const matchFormatViolation = checkMatchScores(
    parseMatchFormat(tournament.match_format_type, tournament.match_format_value),
    myScore,
    opponentScore,
    { decisive: true },
  );
  if (matchFormatViolation) throw new Error(matchFormatViolation);

  const [matches] = await connection.execute<MatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      team1_report_score,
      team1_report_opponent_score,
      team1_reported_at,
      team2_report_score,
      team2_report_opponent_score,
      team2_reported_at,
      score_deadline_at,
      next_winner_match_id,
      next_winner_slot,
      next_loser_match_id,
      next_loser_slot,
      winner_team_id,
      status
     FROM bg_matches
     WHERE id = ?
       AND tournament_id = ?
     LIMIT 1`,
    [matchId, tournamentId],
  );

  if (matches.length === 0) throw new Error("MATCH_NOT_FOUND");
  const match = matches[0];

  if (match.winner_team_id !== null) {
    throw new Error("MATCH_ALREADY_COMPLETED");
  }

  if (match.team1_id === null || match.team2_id === null) {
    throw new Error("MATCH_NOT_READY");
  }

  const isTeam1Reporter = Number(match.team1_id) === reporterTeamId;
  const isTeam2Reporter = Number(match.team2_id) === reporterTeamId;

  if (!isTeam1Reporter && !isTeam2Reporter) {
    throw new Error("NOT_IN_MATCH");
  }

  if (isTeam1Reporter) {
    await connection.execute(
      `UPDATE bg_matches
       SET team1_report_score = ?,
           team1_report_opponent_score = ?,
           team1_reported_at = NOW(),
           score_deadline_at = COALESCE(score_deadline_at, DATE_ADD(NOW(), INTERVAL ? MINUTE)),
           status = 'AWAITING_CONFIRMATION'
       WHERE id = ?`,
      [myScore, opponentScore, SCORE_REPORT_TIMEOUT_MINUTES, matchId],
    );
  }

  if (isTeam2Reporter) {
    await connection.execute(
      `UPDATE bg_matches
       SET team2_report_score = ?,
           team2_report_opponent_score = ?,
           team2_reported_at = NOW(),
           score_deadline_at = COALESCE(score_deadline_at, DATE_ADD(NOW(), INTERVAL ? MINUTE)),
           status = 'AWAITING_CONFIRMATION'
       WHERE id = ?`,
      [myScore, opponentScore, SCORE_REPORT_TIMEOUT_MINUTES, matchId],
    );
  }

  const [updatedRows] = await connection.execute<MatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      team1_report_score,
      team1_report_opponent_score,
      team1_reported_at,
      team2_report_score,
      team2_report_opponent_score,
      team2_reported_at,
      score_deadline_at,
      next_winner_match_id,
      next_winner_slot,
      next_loser_match_id,
      next_loser_slot
    FROM bg_matches
    WHERE id = ?
    LIMIT 1`,
    [matchId],
  );

  const updated = updatedRows[0];

  if (
    updated.team1_report_score !== null &&
    updated.team1_report_opponent_score !== null &&
    updated.team2_report_score !== null &&
    updated.team2_report_opponent_score !== null
  ) {
    const consistent =
      Number(updated.team1_report_score) === Number(updated.team2_report_opponent_score) &&
      Number(updated.team1_report_opponent_score) === Number(updated.team2_report_score);

    if (consistent) {
      const team1Score = Number(updated.team1_report_score);
      const team2Score = Number(updated.team1_report_opponent_score);
      const winnerTeamId = team1Score > team2Score ? Number(updated.team1_id) : Number(updated.team2_id);
      const loserTeamId =
        winnerTeamId === Number(updated.team1_id) ? Number(updated.team2_id) : Number(updated.team1_id);

      await finalizeMatch(connection, tournamentId, updated, {
        team1Score,
        team2Score,
        winnerTeamId,
        loserTeamId,
      });
    } else {
      await connection.execute(`UPDATE bg_matches SET status = 'AWAITING_CONFIRMATION' WHERE id = ?`, [
        matchId,
      ]);

      // Les deux engagés se contredisent : un arbitre doit trancher, et il ne
      // le saura que par le canal Discord — d'où une alerte, résolue après le
      // commit comme les lignes de journal (`./bot-logs`).
      //
      // Réservée, et pas seulement mise en file : rien n'interdit aux deux
      // engagées de resaisir leur score tant que la manche n'est pas tranchée,
      // et chaque désaccord ferait sinon sonner le téléphone de tous les
      // arbitres. La réservation est effacée par `finalizeMatch`, si bien qu'un
      // désaccord qui renaît après un arbitrage alerte de nouveau.
      await queueRefereeAlert(connection, { kind: "score_conflict", matchId });
    }
  }

  await tryAutoResolveByes(connection, tournamentId);
}
