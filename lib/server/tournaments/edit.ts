/**
 * Édition d'un tournoi après création.
 *
 * Le module vit hors de `index.ts`, déjà volumineux. Il ne décide pas *ce qui*
 * est modifiable — c'est `lib/shared/tournament-edit.ts`, partagé avec
 * l'interface — ni si les valeurs sont saines — c'est `./validation.ts`,
 * partagé avec la création. Il orchestre : verrou, contrôle, écriture, event.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import {
  checkEditPatch,
  editWindowFor,
  type EditWindow,
  type TournamentField,
} from "@/lib/shared/tournament-edit";
import type { MatchFormat } from "@/lib/shared/match-format";
import type { ParticipantType } from "@/lib/shared/participants";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import { normalizePhaseConfigs, validatePhases } from "@/lib/shared/tournament-phases";
import type { TournamentFormat, TournamentGame, TournamentState } from "@/lib/shared/types";
import { toIso } from "@/lib/server/serialization";
import { validateDateOrder, validateTournamentInput } from "./validation";
import { insertPhases } from "./phases-repository";
import { publishUpdatedEvent } from "./notifications";

/** Valeurs éditables d'un tournoi. Dates en ISO, comme partout côté client. */
export type EditableTournamentValues = {
  name: string;
  description: string | null;
  game: TournamentGame;
  format: TournamentFormat;
  participantType: ParticipantType;
  maxTeams: number;
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
  hasThirdPlaceMatch: boolean;
  survivalRoundsBeforeFirstCut: number | null;
  survivalRoundsPerCut: number | null;
  swissTotalRounds: number | null;
  swissPointsWin: number | null;
  swissPointsDraw: number | null;
  swissPointsLoss: number | null;
  endurancePoints: number | null;
  enduranceWinDelta: number | null;
  enduranceLossDelta: number | null;
  endurancePlayoffSize: number | null;
  matchFormat: MatchFormat | null;
  phases: PhaseConfig[] | null;
};

type EditRow = RowDataPacket & Record<string, never>;

/**
 * Lit la ligne avec **toutes** les colonnes éditables.
 *
 * `loadTournamentRow` ne suffit pas : elle ignore le barème suisse et les
 * réglages d'endurance, que le formulaire doit pourtant préremplir.
 */
async function loadEditRow(
  connection: PoolConnection,
  tournamentId: number,
  forUpdate: boolean,
): Promise<Record<string, unknown> | null> {
  const [rows] = await connection.execute<EditRow[]>(
    `SELECT
      id, name, description, format, game, participant_type, max_teams, state,
      start_visibility_at, registration_open_at, registration_close_at, start_at,
      has_third_place_match,
      survival_rounds_before_first_cut, survival_rounds_per_cut,
      swiss_total_rounds, swiss_points_win, swiss_points_draw, swiss_points_loss,
      endurance_start_points, endurance_win_delta, endurance_loss_delta,
      endurance_playoff_size,
      match_format_type, match_format_value
     FROM bg_tournaments
     WHERE id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tournamentId],
  );

  return rows.length === 0 ? null : (rows[0] as unknown as Record<string, unknown>);
}

/** Convertit une ligne SQL en valeurs éditables. */
function toValues(
  row: Record<string, unknown>,
  phases: PhaseConfig[] | null,
): EditableTournamentValues {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    name: String(row.name),
    description: row.description === null ? null : String(row.description),
    game: row.game as TournamentGame,
    format: row.format as TournamentFormat,
    participantType: row.participant_type as ParticipantType,
    maxTeams: Number(row.max_teams),
    startVisibilityAt: toIso(row.start_visibility_at as Date)!,
    registrationOpenAt: toIso(row.registration_open_at as Date)!,
    registrationCloseAt: toIso(row.registration_close_at as Date)!,
    startAt: toIso(row.start_at as Date)!,
    hasThirdPlaceMatch: Boolean(row.has_third_place_match),
    survivalRoundsBeforeFirstCut: num(row.survival_rounds_before_first_cut),
    survivalRoundsPerCut: num(row.survival_rounds_per_cut),
    swissTotalRounds: num(row.swiss_total_rounds),
    swissPointsWin: num(row.swiss_points_win),
    swissPointsDraw: num(row.swiss_points_draw),
    swissPointsLoss: num(row.swiss_points_loss),
    endurancePoints: num(row.endurance_start_points),
    enduranceWinDelta: num(row.endurance_win_delta),
    enduranceLossDelta: num(row.endurance_loss_delta),
    endurancePlayoffSize: num(row.endurance_playoff_size),
    matchFormat:
      row.match_format_type === null || row.match_format_value === null
        ? null
        : {
            type: row.match_format_type as MatchFormat["type"],
            value: Number(row.match_format_value),
          },
    phases,
  };
}

/** Phases d'un tournoi MULTI, sous la forme attendue par le formulaire. */
async function loadPhaseConfigs(
  connection: PoolConnection,
  tournamentId: number,
): Promise<PhaseConfig[]> {
  const [rows] = await connection.execute<EditRow[]>(
    `SELECT position, name, format, qualifier_mode, qualifier_value,
            has_third_place_match, swiss_total_rounds,
            survival_rounds_before_first_cut, survival_rounds_per_cut
     FROM bg_tournament_phases
     WHERE tournament_id = ?
     ORDER BY position ASC`,
    [tournamentId],
  );

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    position: Number(row.position),
    format: row.format as PhaseConfig["format"],
    name: row.name === null ? null : String(row.name),
    qualifierMode: row.qualifier_mode as PhaseConfig["qualifierMode"],
    qualifierValue: Number(row.qualifier_value),
    hasThirdPlaceMatch: Boolean(row.has_third_place_match),
    swissTotalRounds: row.swiss_total_rounds === null ? null : Number(row.swiss_total_rounds),
    survivalRoundsBeforeFirstCut:
      row.survival_rounds_before_first_cut === null
        ? null
        : Number(row.survival_rounds_before_first_cut),
    survivalRoundsPerCut:
      row.survival_rounds_per_cut === null ? null : Number(row.survival_rounds_per_cut),
  }));
}

export async function loadEditableTournament(
  tournamentId: number,
): Promise<{ window: EditWindow; values: EditableTournamentValues } | null> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    const row = await loadEditRow(connection, tournamentId, false);
    if (!row) return null;

    const phases =
      row.format === "MULTI" ? await loadPhaseConfigs(connection, tournamentId) : null;
    const values = toValues(row, phases);

    return {
      window: editWindowFor({
        state: row.state as TournamentState,
        startVisibilityAt: values.startVisibilityAt,
        maxTeams: values.maxTeams,
      }),
      values,
    };
  } finally {
    connection.release();
  }
}

export async function updateTournament(
  tournamentId: number,
  patch: Partial<EditableTournamentValues>,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const row = await loadEditRow(connection, tournamentId, true);
    if (!row) throw new Error("TOURNAMENT_NOT_FOUND");

    const current = toValues(
      row,
      row.format === "MULTI" ? await loadPhaseConfigs(connection, tournamentId) : null,
    );

    // La fenêtre est recalculée ici, sous verrou : un tournoi devenu visible ou
    // lancé depuis le chargement du formulaire est refusé, pas modifié en silence.
    const editable = {
      state: row.state as TournamentState,
      startVisibilityAt: current.startVisibilityAt,
      maxTeams: current.maxTeams,
    };

    if (editWindowFor(editable) === "LOCKED") throw new Error("TOURNAMENT_LOCKED");

    const violation = checkEditPatch(editable, patch as Partial<Record<TournamentField, unknown>>);
    if (violation) {
      throw new Error(
        violation.code === "FIELD_NOT_EDITABLE"
          ? `FIELD_NOT_EDITABLE:${violation.field}`
          : violation.code,
      );
    }

    const next: EditableTournamentValues = { ...current, ...patch };

    const validation = validateTournamentInput({
      name: next.name,
      description: next.description,
      format: next.format,
      game: next.game,
      participantType: next.participantType,
      maxTeams: next.maxTeams,
      hasThirdPlaceMatch: next.hasThirdPlaceMatch,
      survivalRoundsBeforeFirstCut: next.survivalRoundsBeforeFirstCut ?? undefined,
      survivalRoundsPerCut: next.survivalRoundsPerCut ?? undefined,
      swissTotalRounds: next.swissTotalRounds ?? undefined,
      swissPointsWin: next.swissPointsWin ?? undefined,
      swissPointsDraw: next.swissPointsDraw ?? undefined,
      swissPointsLoss: next.swissPointsLoss ?? undefined,
      endurancePoints: next.endurancePoints ?? undefined,
      enduranceWinDelta: next.enduranceWinDelta ?? undefined,
      enduranceLossDelta: next.enduranceLossDelta ?? undefined,
      endurancePlayoffSize: next.endurancePlayoffSize ?? undefined,
      matchFormatType: next.matchFormat?.type ?? null,
      matchFormatValue: next.matchFormat?.value ?? null,
      phases: next.phases ?? undefined,
    });
    if ("error" in validation) throw new Error(validation.error);
    const valid = validation.value;

    const dateError = validateDateOrder({
      startVisibilityAt: next.startVisibilityAt,
      registrationOpenAt: next.registrationOpenAt,
      registrationCloseAt: next.registrationCloseAt,
      startAt: next.startAt,
    });
    if (dateError) throw new Error(dateError);

    // Les phases brutes de `validateTournamentInput` ne portent pas de position
    // (le client ne l'envoie pas) : il faut les normaliser puis les valider
    // strictement avant d'y toucher, exactement comme `createTournament`
    // (lib/server/tournaments/index.ts).
    let normalizedPhases: PhaseConfig[] | null = null;
    if (valid.format === "MULTI" && valid.phases) {
      normalizedPhases = normalizePhaseConfigs(valid.phases);
      const phaseError = validatePhases(normalizedPhases);
      if (phaseError) throw new Error(phaseError);
    }

    await connection.execute(
      `UPDATE bg_tournaments SET
        name = ?, description = ?, game = ?, format = ?, participant_type = ?,
        max_teams = ?,
        start_visibility_at = ?, registration_open_at = ?,
        registration_close_at = ?, start_at = ?,
        has_third_place_match = ?,
        survival_rounds_before_first_cut = ?, survival_rounds_per_cut = ?,
        swiss_total_rounds = ?, swiss_points_win = ?, swiss_points_draw = ?, swiss_points_loss = ?,
        endurance_start_points = ?, endurance_win_delta = ?, endurance_loss_delta = ?,
        endurance_playoff_size = ?,
        match_format_type = ?, match_format_value = ?
       WHERE id = ?`,
      [
        valid.name,
        valid.description,
        valid.game,
        valid.format,
        valid.participantType,
        valid.maxTeams,
        new Date(next.startVisibilityAt),
        new Date(next.registrationOpenAt),
        new Date(next.registrationCloseAt),
        new Date(next.startAt),
        valid.hasThirdPlaceMatch ? 1 : 0,
        valid.survivalRoundsBeforeFirstCut,
        valid.survivalRoundsPerCut,
        valid.swissTotalRounds,
        valid.swissPointsWin ?? 3,
        valid.swissPointsDraw ?? 1,
        valid.swissPointsLoss ?? 0,
        valid.endurancePoints,
        valid.enduranceWinDelta,
        valid.enduranceLossDelta,
        valid.endurancePlayoffSize,
        valid.matchFormat?.type ?? null,
        valid.matchFormat?.value ?? null,
        tournamentId,
      ],
    );

    // Les phases sont toujours reposées à neuf : l'invariant qui rend cela sûr
    // repose sur l'état du tournoi. Seules les fonctions de démarrage
    // (initializeMultiTournament, startPhase) et le recalcul du seeding écrivent
    // une phase_id, et toutes exigent state === "RUNNING". Or, on a jeté
    // TOURNAMENT_LOCKED plus haut si l'état était RUNNING : donc aucune phase
    // n'existe au moment de ce DELETE. Il n'y a pas de clé étrangère pour
    // protéger cet invariant — une réduction future du verrou sur l'édition
    // pourrait le briser silencieusement.
    await connection.execute(`DELETE FROM bg_tournament_phases WHERE tournament_id = ?`, [
      tournamentId,
    ]);
    if (valid.format === "MULTI" && normalizedPhases) {
      await insertPhases(connection, tournamentId, normalizedPhases);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  publishUpdatedEvent(tournamentId);
}
