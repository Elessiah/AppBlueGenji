import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import type { TournamentPhaseStanding } from "@/lib/shared/types";
import { PhaseRow, mapPhase } from "./_internal";

/** Insère les phases dans la base de données dans l'ordre de position. */
export async function insertPhases(
  connection: PoolConnection,
  tournamentId: number,
  phases: PhaseConfig[],
): Promise<number[]> {
  const ids: number[] = [];

  for (const phase of phases) {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bg_tournament_phases (
        tournament_id, position, name, format,
        qualifier_mode, qualifier_value, has_third_place_match,
        swiss_total_rounds,
        survival_rounds_before_first_cut, survival_rounds_per_cut
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tournamentId,
        phase.position,
        phase.name,
        phase.format,
        phase.qualifierMode,
        phase.qualifierValue,
        phase.hasThirdPlaceMatch ? 1 : 0,
        phase.swissTotalRounds,
        phase.survivalRoundsBeforeFirstCut,
        phase.survivalRoundsPerCut,
      ],
    );

    ids.push(Number(result.insertId));
  }

  return ids;
}

/** Charge toutes les phases d'un tournoi, triées par position. */
export async function loadPhases(
  connection: PoolConnection,
  tournamentId: number,
): Promise<PhaseRow[]> {
  const [rows] = await connection.execute<PhaseRow[]>(
    `SELECT
      id, tournament_id, position, name, format,
      qualifier_mode, qualifier_value, has_third_place_match,
      swiss_total_rounds,
      survival_rounds_before_first_cut, survival_rounds_per_cut,
      survival_current_round, survival_barrage_rounds,
      state, entrants, qualifiers, max_rounds, bracket_size,
      started_at, finished_at, created_at
     FROM bg_tournament_phases
     WHERE tournament_id = ?
     ORDER BY position ASC`,
    [tournamentId],
  );

  return rows;
}

/** Charge une phase par ID, optionnellement avec verrou SELECT FOR UPDATE. */
export async function loadPhase(
  connection: PoolConnection,
  phaseId: number,
  forUpdate = false,
): Promise<PhaseRow | null> {
  const suffix = forUpdate ? " FOR UPDATE" : "";
  const [rows] = await connection.execute<PhaseRow[]>(
    `SELECT
      id, tournament_id, position, name, format,
      qualifier_mode, qualifier_value, has_third_place_match,
      swiss_total_rounds,
      survival_rounds_before_first_cut, survival_rounds_per_cut,
      survival_current_round, survival_barrage_rounds,
      state, entrants, qualifiers, max_rounds, bracket_size,
      started_at, finished_at, created_at
     FROM bg_tournament_phases
     WHERE id = ?${suffix}
     LIMIT 1`,
    [phaseId],
  );

  return rows.length === 0 ? null : rows[0];
}

/** Met à jour les métriques de résolution d'une phase (effectifs, qualifications, nombre de rounds). */
export async function updatePhaseResolution(
  connection: PoolConnection,
  phaseId: number,
  params: {
    entrants?: number | null;
    qualifiers?: number | null;
    maxRounds?: number | null;
    state?: "PENDING" | "RUNNING" | "FINISHED" | "SKIPPED";
  },
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];

  if ("entrants" in params && params.entrants !== undefined) {
    updates.push("entrants = ?");
    values.push(params.entrants);
  }
  if ("qualifiers" in params && params.qualifiers !== undefined) {
    updates.push("qualifiers = ?");
    values.push(params.qualifiers);
  }
  if ("maxRounds" in params && params.maxRounds !== undefined) {
    updates.push("max_rounds = ?");
    values.push(params.maxRounds);
  }
  if ("state" in params && params.state !== undefined) {
    updates.push("state = ?");
    values.push(params.state);
  }

  if (updates.length === 0) return;

  values.push(phaseId);
  await connection.execute(`UPDATE bg_tournament_phases SET ${updates.join(", ")} WHERE id = ?`, values);
}

/** Définit l'état d'une phase et, optionnellement, un timestamp (started_at ou finished_at). */
export async function setPhaseState(
  connection: PoolConnection,
  phaseId: number,
  state: "PENDING" | "RUNNING" | "FINISHED" | "SKIPPED",
  timestampField?: "started_at" | "finished_at",
): Promise<void> {
  if (timestampField) {
    await connection.execute(
      `UPDATE bg_tournament_phases SET state = ?, ${timestampField} = NOW() WHERE id = ?`,
      [state, phaseId],
    );
  } else {
    await connection.execute(`UPDATE bg_tournament_phases SET state = ? WHERE id = ?`, [
      state,
      phaseId,
    ]);
  }
}

/** Définit la phase active d'un tournoi. */
export async function setCurrentPhase(
  connection: PoolConnection,
  tournamentId: number,
  phaseId: number | null,
): Promise<void> {
  await connection.execute(`UPDATE bg_tournaments SET current_phase_id = ? WHERE id = ?`, [
    phaseId,
    tournamentId,
  ]);
}

/** Enregistre les équipes d'une phase avec seed. Upsert : met à jour le seed si la paire existe. */
export async function insertPhaseTeams(
  connection: PoolConnection,
  tournamentId: number,
  phaseId: number,
  teams: Array<{ teamId: number; seed: number }>,
): Promise<void> {
  if (teams.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (const team of teams) {
    placeholders.push("(?, ?, ?, ?)");
    values.push(phaseId, tournamentId, team.teamId, team.seed);
  }

  await connection.execute(
    `INSERT INTO bg_tournament_phase_teams (phase_id, tournament_id, team_id, seed)
     VALUES ${placeholders.join(", ")}
     ON DUPLICATE KEY UPDATE seed = VALUES(seed)`,
    values,
  );
}

/** Charge les IDs des équipes d'une phase, triés par seed. */
export async function loadPhaseTeamIds(
  connection: PoolConnection,
  phaseId: number,
): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT team_id FROM bg_tournament_phase_teams
     WHERE phase_id = ?
     ORDER BY seed ASC`,
    [phaseId],
  );

  return rows.map((row) => Number(row.team_id));
}

/** Enregistre les résultats (rang, qualification) des équipes d'une phase via une seule UPDATE CASE. */
export async function savePhaseResults(
  connection: PoolConnection,
  phaseId: number,
  ranked: Array<{ teamId: number; rank: number; qualified: boolean }>,
): Promise<void> {
  if (ranked.length === 0) return;

  const caseRank: string[] = [];
  const caseQualified: string[] = [];
  const values: (number | boolean)[] = [];

  for (const item of ranked) {
    caseRank.push("WHEN ? THEN ?");
    caseQualified.push("WHEN ? THEN ?");
    values.push(item.teamId, item.rank, item.teamId, item.qualified ? 1 : 0);
  }

  await connection.execute(
    `UPDATE bg_tournament_phase_teams
     SET \`rank\` = CASE team_id ${caseRank.join(" ")} ELSE \`rank\` END,
         qualified = CASE team_id ${caseQualified.join(" ")} ELSE qualified END
     WHERE phase_id = ?`,
    [...values, phaseId],
  );
}

/** Charge le classement d'une phase avec les données d'équipe, trié par rang puis seed. */
export async function loadPhaseStandings(
  connection: PoolConnection,
  phaseId: number,
): Promise<TournamentPhaseStanding[]> {
  const [rows] = await connection.execute<
    (RowDataPacket & TournamentPhaseStanding & { seed: number })[]
  >(
    `SELECT
      pt.team_id AS teamId,
      t.name AS teamName,
      t.logo_url AS logoUrl,
      pt.seed,
      pt.\`rank\`,
      pt.qualified
     FROM bg_tournament_phase_teams pt
     JOIN bg_teams t ON t.id = pt.team_id
     WHERE pt.phase_id = ?
     ORDER BY pt.\`rank\` IS NULL, pt.\`rank\` ASC, pt.seed ASC`,
    [phaseId],
  );

  return rows.map((row) => ({
    teamId: Number(row.teamId),
    teamName: row.teamName,
    logoUrl: row.logoUrl,
    seed: Number(row.seed),
    rank: row.rank === null ? null : Number(row.rank),
    qualified: Boolean(row.qualified),
  }));
}
