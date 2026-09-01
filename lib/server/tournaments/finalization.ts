import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { MIN_ENTRANTS_FOR_MATCHES } from "@/lib/shared/constants";
import { queueBotLog } from "./bot-logs";
import { resetRegistrationRanks, finishTournament } from "./repository";

export async function isEliminationPhaseComplete(
  connection: PoolConnection,
  tournamentId: number,
  phaseId: number,
): Promise<boolean> {
  const [matchCount] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_matches WHERE tournament_id = ? AND phase_id = ?`,
    [tournamentId, phaseId],
  );

  if (Number(matchCount[0]?.c ?? 0) === 0) {
    return false;
  }

  const [unfinished] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c
     FROM bg_matches
     WHERE tournament_id = ? AND phase_id = ?
       AND winner_team_id IS NULL
       AND (team1_id IS NOT NULL OR team2_id IS NOT NULL)`,
    [tournamentId, phaseId],
  );

  return Number(unfinished[0]?.c ?? 0) === 0;
}

export async function rankEliminationPhase(
  connection: PoolConnection,
  tournamentId: number,
  phaseId: number,
  format: "SINGLE" | "DOUBLE",
  hasThirdPlaceMatch: boolean,
): Promise<number[]> {
  const rankedTeams: number[] = [];

  if (format === "DOUBLE") {
    const [grandFinalRows] = await connection.execute<
      (RowDataPacket & { winner_team_id: number | null; loser_team_id: number | null })[]
    >(
      `SELECT winner_team_id, loser_team_id
       FROM bg_matches
       WHERE tournament_id = ? AND phase_id = ? AND bracket = 'GRAND' AND round_number = 1`,
      [tournamentId, phaseId],
    );
    const grandFinal = grandFinalRows[0];
    if (grandFinal?.winner_team_id) {
      rankedTeams.push(Number(grandFinal.winner_team_id));
    }
    if (grandFinal?.loser_team_id) {
      rankedTeams.push(Number(grandFinal.loser_team_id));
    }
  } else {
    const [upperFinalRows] = await connection.execute<
      (RowDataPacket & { winner_team_id: number | null; loser_team_id: number | null })[]
    >(
      `SELECT winner_team_id, loser_team_id
       FROM bg_matches
       WHERE tournament_id = ? AND phase_id = ? AND bracket = 'UPPER'
       ORDER BY round_number DESC
       LIMIT 1`,
      [tournamentId, phaseId],
    );
    const upperFinal = upperFinalRows[0];
    if (upperFinal?.winner_team_id) {
      rankedTeams.push(Number(upperFinal.winner_team_id));
    }
    if (upperFinal?.loser_team_id) {
      rankedTeams.push(Number(upperFinal.loser_team_id));
    }

    if (hasThirdPlaceMatch) {
      const [thirdPlaceRows] = await connection.execute<
        (RowDataPacket & { winner_team_id: number | null; loser_team_id: number | null })[]
      >(
        `SELECT winner_team_id, loser_team_id
         FROM bg_matches
         WHERE tournament_id = ? AND phase_id = ? AND bracket = 'THIRD_PLACE'
         LIMIT 1`,
        [tournamentId, phaseId],
      );
      const thirdPlace = thirdPlaceRows[0];
      if (thirdPlace?.winner_team_id) {
        rankedTeams.push(Number(thirdPlace.winner_team_id));
      }
      if (thirdPlace?.loser_team_id) {
        rankedTeams.push(Number(thirdPlace.loser_team_id));
      }
    }
  }

  if (rankedTeams.length > 0) {
    const placeholders = rankedTeams.map(() => "?").join(",");
    const [rankingRows] = await connection.execute<
      (RowDataPacket & {
        team_id: number;
        wins: number;
        losses: number;
        last_progress_at: Date | null;
      })[]
    >(
      `SELECT
        r.team_id,
        COALESCE(SUM(CASE WHEN m.winner_team_id = r.team_id THEN 1 ELSE 0 END), 0) AS wins,
        COALESCE(SUM(CASE WHEN m.loser_team_id = r.team_id THEN 1 ELSE 0 END), 0) AS losses,
        MAX(CASE
          WHEN m.winner_team_id = r.team_id OR m.loser_team_id = r.team_id
            THEN m.updated_at
          ELSE NULL
        END) AS last_progress_at
       FROM bg_tournament_registrations r
       LEFT JOIN bg_matches m ON m.tournament_id = r.tournament_id AND m.phase_id = ?
       WHERE r.tournament_id = ? AND r.team_id NOT IN (${placeholders})
       GROUP BY r.team_id
       ORDER BY wins DESC, losses ASC, last_progress_at DESC`,
      [phaseId, tournamentId, ...rankedTeams],
    );

    for (const row of rankingRows) {
      rankedTeams.push(Number(row.team_id));
    }
  }

  return rankedTeams;
}

/**
 * Clôt sans jouer un tournoi qui atteint son coup d'envoi sans adversaires.
 *
 * Un plateau vide ou réduit à une seule engagée n'a aucun match à produire : le
 * laisser passer en `RUNNING` l'y bloquerait pour de bon, puisque c'est
 * justement la fin des matchs qui clôt un tournoi. La règle est **commune à
 * tous les formats** et appliquée avant toute initialisation, si bien qu'aucun
 * moteur (plateau, Survie, Ronde suisse, Endurance, phases) n'a besoin de
 * connaître ce cas dégénéré ni de créer un classement pour personne.
 *
 * L'unique engagée, s'il y en a une, est déclarée première — c'est déjà ce que
 * faisait l'élimination dans `createBracketIfMissing`.
 *
 * Une inscription n'est jamais retirée en cours de route : un tournoi qui en
 * compte moins de deux n'a donc pas pu commencer, ce qui rend l'appel sûr aussi
 * bien à la bascule qu'à l'entretien d'un tournoi déjà `RUNNING`.
 *
 * @returns `true` si le tournoi a été clos, `false` s'il a de quoi être joué.
 */
export async function finalizeUnderfilledTournament(
  connection: PoolConnection,
  tournamentId: number,
): Promise<boolean> {
  // Le `LIMIT` s'arrête au seuil : seule la distinction « moins de deux » nous
  // intéresse, jamais l'effectif exact d'un plateau à 128. Le nombre vient de
  // `MIN_ENTRANTS_FOR_MATCHES` (`lib/shared/constants.ts`), partagé avec la
  // confirmation du lancement anticipé, qui annonce cette clôture avant le clic
  // — écrit deux fois, il aurait fini par se contredire. C'est une constante du
  // module, jamais une entrée : rien d'externe n'atteint cette interpolation.
  const [rows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT team_id FROM bg_tournament_registrations
     WHERE tournament_id = ? LIMIT ${MIN_ENTRANTS_FOR_MATCHES}`,
    [tournamentId],
  );

  if (rows.length >= MIN_ENTRANTS_FOR_MATCHES) return false;

  if (rows.length === 1) {
    await connection.execute(
      `UPDATE bg_tournament_registrations
       SET final_rank = 1
       WHERE tournament_id = ? AND team_id = ?`,
      [tournamentId, Number(rows[0].team_id)],
    );
  }

  // `bracket_size` reçoit l'effectif retenu : même écriture, mêmes colonnes que
  // la clôture d'un plateau vide dans `createBracketIfMissing`, pour qu'un
  // tournoi clos porte toujours la taille de son plateau plutôt qu'un NULL.
  await connection.execute(
    `UPDATE bg_tournaments
     SET state = 'FINISHED', finished_at = NOW(), bracket_size = ?
     WHERE id = ?`,
    [rows.length, tournamentId],
  );

  // Un tournoi qui se clôt sans avoir joué est un incident d'organisation : il
  // mérite sa ligne, et une ligne à lui — la clôture ordinaire annonce une
  // championne, celle-ci annonce une salle vide.
  queueBotLog(connection, { kind: "tournament_underfilled", tournamentId });

  return true;
}

export async function finalizeTournamentIfDone(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  // Les modes à classement (Survie, Ronde suisse) pilotent eux-mêmes leur
  // clôture et leur classement final via `reconcileSurvival` / `reconcileSwiss`
  // — ne pas les finaliser ici, sinon le classement générique par victoires
  // écraserait le résultat. En suisse, une ronde terminée ne clôt d'ailleurs
  // rien tant que le compte de rondes prévues n'est pas atteint.
  // Le mode MULTI est, lui, orchestré par `reconcilePhases` : c'est la phase
  // finale qui décide de la clôture et du classement global. « BlueGenji
  // Survie » suit la même règle via `reconcileEndurance` / `finalizeEndurance` :
  // sans cette garde, un instant où tous les matchs sont terminés (entre deux
  // manches) suffirait à clore le tournoi et à écraser le podium d'endurance.
  const [formatRows] = await connection.execute<(RowDataPacket & { format: string })[]>(
    `SELECT format FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  const format = formatRows[0]?.format;
  if (
    format === "SURVIVAL" ||
    format === "SWISS" ||
    format === "MULTI" ||
    format === "BG_SURVIE"
  ) {
    return;
  }

  const phaseId = 0;
  const isComplete = await isEliminationPhaseComplete(connection, tournamentId, phaseId);

  if (!isComplete) {
    return;
  }

  await finishTournament(connection, tournamentId);
  await resetRegistrationRanks(connection, tournamentId);

  const [tournamentMetaRows] = await connection.execute<
    (RowDataPacket & { format: string; has_third_place_match: number })[]
  >(`SELECT format, has_third_place_match FROM bg_tournaments WHERE id = ? LIMIT 1`, [
    tournamentId,
  ]);
  const tournamentMeta = tournamentMetaRows[0];

  const rankedTeams = await rankEliminationPhase(
    connection,
    tournamentId,
    phaseId,
    (tournamentMeta?.format === "DOUBLE" ? "DOUBLE" : "SINGLE") as "SINGLE" | "DOUBLE",
    Boolean(tournamentMeta?.has_third_place_match),
  );

  let rank = 1;
  for (const teamId of rankedTeams) {
    await connection.execute(
      `UPDATE bg_tournament_registrations
       SET final_rank = ?
       WHERE tournament_id = ? AND team_id = ?`,
      [rank, tournamentId, teamId],
    );
    rank += 1;
  }
}

export async function resolveExpiredScoreReports(
  connection: PoolConnection,
  tournamentId: number,
): Promise<void> {
  const [rows] = await connection.execute<MatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      team1_report_score,
      team1_report_opponent_score,
      team2_report_score,
      team2_report_opponent_score,
      next_winner_match_id,
      next_winner_slot,
      next_loser_match_id,
      next_loser_slot
     FROM bg_matches
     WHERE tournament_id = ?
       AND status = 'AWAITING_CONFIRMATION'
       AND score_deadline_at IS NOT NULL
       AND score_deadline_at <= NOW()
       AND winner_team_id IS NULL`,
    [tournamentId],
  );

  // Import at runtime to avoid circular deps
  const { finalizeMatch } = await import("./scoring");

  for (const match of rows) {
    if (match.team1_id === null || match.team2_id === null) {
      continue;
    }

    if (
      match.team1_report_score !== null &&
      match.team1_report_opponent_score !== null &&
      match.team2_report_score === null
    ) {
      const team1Score = Number(match.team1_report_score);
      const team2Score = Number(match.team1_report_opponent_score);
      const winnerTeamId = team1Score >= team2Score ? Number(match.team1_id) : Number(match.team2_id);
      const loserTeamId =
        winnerTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);

      await finalizeMatch(connection, tournamentId, match, {
        team1Score,
        team2Score,
        winnerTeamId,
        loserTeamId,
      });
    }

    if (
      match.team2_report_score !== null &&
      match.team2_report_opponent_score !== null &&
      match.team1_report_score === null
    ) {
      const team1Score = Number(match.team2_report_opponent_score);
      const team2Score = Number(match.team2_report_score);
      const winnerTeamId = team1Score >= team2Score ? Number(match.team1_id) : Number(match.team2_id);
      const loserTeamId =
        winnerTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);

      await finalizeMatch(connection, tournamentId, match, {
        team1Score,
        team2Score,
        winnerTeamId,
        loserTeamId,
      });
    }
  }
}

// Import MatchRow type
import type { MatchRow } from "./_internal";
