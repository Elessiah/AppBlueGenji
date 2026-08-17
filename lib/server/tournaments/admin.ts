import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { PhaseFormat, TournamentFormat } from "@/lib/shared/types";
import { dependentMatches, hasScoreInput, type MatchScoreState } from "@/lib/shared/match-lock";
import { MatchRow } from "./_internal";
import { finalizeMatch } from "./scoring";
import { tryAutoResolveByes } from "./byes";

interface DependentMatchRow extends RowDataPacket {
  id: number;
  round_number: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team_id: number | null;
  forfeit_team_id: number | null;
  team1_reported_at: string | null;
  team2_reported_at: string | null;
}

const DEPENDENT_COLUMNS = `id, round_number, team1_id, team2_id, team1_score, team2_score,
   winner_team_id, forfeit_team_id, team1_reported_at, team2_reported_at`;

/** Mêmes colonnes, qualifiées par l'alias `m` (requêtes avec jointure). */
const DEPENDENT_COLUMNS_M = DEPENDENT_COLUMNS.split(",")
  .map((column) => `m.${column.trim()}`)
  .join(", ");

function toMatchScoreState(row: DependentMatchRow): MatchScoreState {
  return {
    id: Number(row.id),
    roundNumber: Number(row.round_number),
    team1Id: row.team1_id === null ? null : Number(row.team1_id),
    team2Id: row.team2_id === null ? null : Number(row.team2_id),
    team1Score: row.team1_score === null ? null : Number(row.team1_score),
    team2Score: row.team2_score === null ? null : Number(row.team2_score),
    winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
    forfeitTeamId: row.forfeit_team_id === null ? null : Number(row.forfeit_team_id),
    hasPendingReport: row.team1_reported_at !== null || row.team2_reported_at !== null,
    nextWinnerMatchId: null,
    nextLoserMatchId: null,
  };
}

/**
 * Refuse la modification d'un score dès que la manche suivante porte la moindre
 * saisie — un score (même 0), un vainqueur, un forfait ou un report en attente.
 * La règle vaut aussi pour les admins : réécrire un résultat amont changerait
 * les participants d'un match déjà entamé.
 *
 * La liste des matchs dépendants suit le format : liens de bracket en
 * élimination simple/double, rounds ultérieurs en survie et en ronde suisse (où
 * les appariements sont recalculés depuis le classement). Voir
 * `lib/shared/match-lock.ts`, partagé avec l'interface.
 */
export async function checkDownstreamMatchesHaveNoScores(
  connection: PoolConnection,
  match: MatchRow,
): Promise<void> {
  const [currentRows] = await connection.execute<
    (RowDataPacket & {
      round_number: number;
      winner_team_id: number | null;
      next_winner_match_id: number | null;
      next_loser_match_id: number | null;
      tournament_id: number;
      phase_id: number | null;
      format: TournamentFormat;
    })[]
  >(
    `SELECT m.round_number, m.winner_team_id, m.next_winner_match_id, m.next_loser_match_id,
            m.tournament_id, m.phase_id, t.format
     FROM bg_matches m
     JOIN bg_tournaments t ON t.id = m.tournament_id
     WHERE m.id = ?
     LIMIT 1`,
    [match.id],
  );

  const current = currentRows[0];
  // Match indécis : rien n'a encore été propagé, la saisie reste ouverte.
  if (!current || current.winner_team_id === null) return;

  let dependents: DependentMatchRow[];

  if (current.format === "MULTI") {
    // Multi-phases : la règle dépend du format de CHAQUE phase et une phase
    // ultérieure dépend toujours de celle-ci. On délègue au module partagé
    // (`lib/shared/match-lock.ts`) pour que serveur et interface appliquent
    // exactement le même verrou, plutôt que de réécrire la règle en SQL.
    const [rows] = await connection.execute<
      (DependentMatchRow & {
        phase_id: number;
        phase_position: number | null;
        next_winner_match_id: number | null;
        next_loser_match_id: number | null;
      })[]
    >(
      `SELECT ${DEPENDENT_COLUMNS_M}, m.phase_id, p.position AS phase_position,
              m.next_winner_match_id, m.next_loser_match_id
       FROM bg_matches m
       LEFT JOIN bg_tournament_phases p ON p.id = m.phase_id
       WHERE m.tournament_id = ?`,
      [Number(current.tournament_id)],
    );

    const [phaseRows] = await connection.execute<
      (RowDataPacket & { format: PhaseFormat })[]
    >(`SELECT format FROM bg_tournament_phases WHERE id = ? LIMIT 1`, [
      Number(current.phase_id ?? 0),
    ]);

    const states = rows.map((row) => ({
      ...toMatchScoreState(row),
      phaseId: Number(row.phase_id ?? 0),
      phasePosition: row.phase_position === null ? null : Number(row.phase_position),
      nextWinnerMatchId:
        row.next_winner_match_id === null ? null : Number(row.next_winner_match_id),
      nextLoserMatchId: row.next_loser_match_id === null ? null : Number(row.next_loser_match_id),
    }));

    const self = states.find((s) => s.id === Number(match.id));
    if (!self) return;

    if (dependentMatches(self, states, "MULTI", phaseRows[0]?.format).some(hasScoreInput)) {
      throw new Error("CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES");
    }
    return;
  }

  if (current.format === "SURVIVAL" || current.format === "SWISS") {
    const [rows] = await connection.execute<DependentMatchRow[]>(
      `SELECT ${DEPENDENT_COLUMNS}
       FROM bg_matches
       WHERE tournament_id = ? AND round_number > ?`,
      [Number(current.tournament_id), Number(current.round_number)],
    );
    dependents = rows;
  } else {
    const targets = [current.next_winner_match_id, current.next_loser_match_id]
      .filter((id): id is number => id !== null && id !== undefined)
      .map(Number);
    if (targets.length === 0) return;

    const [rows] = await connection.execute<DependentMatchRow[]>(
      `SELECT ${DEPENDENT_COLUMNS}
       FROM bg_matches
       WHERE id IN (${targets.map(() => "?").join(", ")})`,
      targets,
    );
    dependents = rows;
  }

  if (dependents.map(toMatchScoreState).some(hasScoreInput)) {
    throw new Error("CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES");
  }
}

export async function adminSaveMatchScores(
  connection: PoolConnection,
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
): Promise<void> {
  const [matches] = await connection.execute<MatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      next_winner_match_id,
      next_loser_match_id,
      winner_team_id
     FROM bg_matches
     WHERE id = ?
     LIMIT 1`,
    [matchId],
  );

  if (matches.length === 0) throw new Error("MATCH_NOT_FOUND");
  const match = matches[0];
  if (match.team1_id === null || match.team2_id === null) throw new Error("MATCH_NOT_READY");

  await checkDownstreamMatchesHaveNoScores(connection, match);

  if (forfeitTeamId !== undefined) {
    await connection.execute(
      `UPDATE bg_matches
       SET team1_score = NULL,
           team2_score = NULL,
           forfeit_team_id = ?
       WHERE id = ?`,
      [forfeitTeamId, matchId],
    );
  } else if (team1Score !== undefined && team2Score !== undefined) {
    await connection.execute(
      `UPDATE bg_matches
       SET team1_score = ?,
           team2_score = ?,
           forfeit_team_id = NULL
       WHERE id = ?`,
      [team1Score, team2Score, matchId],
    );
  } else {
    throw new Error("INVALID_REQUEST");
  }
}

export async function adminResolveMatch(
  connection: PoolConnection,
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
): Promise<void> {
  const [matches] = await connection.execute<MatchRow[]>(
    `SELECT
      id,
      tournament_id,
      team1_id,
      team2_id,
      next_winner_match_id,
      next_winner_slot,
      next_loser_match_id,
      next_loser_slot,
      winner_team_id
     FROM bg_matches
     WHERE id = ?
     LIMIT 1`,
    [matchId],
  );

  if (matches.length === 0) throw new Error("MATCH_NOT_FOUND");
  const match = matches[0];
  if (match.team1_id === null || match.team2_id === null) throw new Error("MATCH_NOT_READY");

  await checkDownstreamMatchesHaveNoScores(connection, match);

  const tournamentId = Number(match.tournament_id);

  let winnerTeamId: number | null;
  let loserTeamId: number | null;
  let resultTeam1Score: number | null;
  let resultTeam2Score: number | null;

  if (forfeitTeamId !== undefined) {
    winnerTeamId =
      forfeitTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);
    loserTeamId =
      forfeitTeamId === Number(match.team1_id) ? Number(match.team1_id) : Number(match.team2_id);
    resultTeam1Score = null;
    resultTeam2Score = null;
  } else if (team1Score !== undefined && team2Score !== undefined) {
    winnerTeamId = team1Score > team2Score ? Number(match.team1_id) : Number(match.team2_id);
    loserTeamId =
      winnerTeamId === Number(match.team1_id) ? Number(match.team2_id) : Number(match.team1_id);
    resultTeam1Score = team1Score;
    resultTeam2Score = team2Score;
  } else {
    throw new Error("INVALID_REQUEST");
  }

  await finalizeMatch(connection, tournamentId, match, {
    team1Score: resultTeam1Score,
    team2Score: resultTeam2Score,
    winnerTeamId,
    loserTeamId,
  });

  if (forfeitTeamId !== undefined) {
    await connection.execute(
      `UPDATE bg_matches SET forfeit_team_id = ? WHERE id = ?`,
      [forfeitTeamId, matchId],
    );
  } else {
    await connection.execute(
      `UPDATE bg_matches SET forfeit_team_id = NULL WHERE id = ?`,
      [matchId],
    );
  }

  await tryAutoResolveByes(connection, tournamentId);
}
