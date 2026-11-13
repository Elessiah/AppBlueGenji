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
import { parseMatchFormat, type MatchFormat } from "@/lib/shared/match-format";
import {
  parseRegistrationFilters,
  type PlayerRequirement,
} from "@/lib/shared/registration-filters";
import type { ParticipantType } from "@/lib/shared/participants";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import { normalizePhaseConfigs, validatePhases } from "@/lib/shared/tournament-phases";
import type { PhaseFormat, TournamentFormat, TournamentGame, TournamentState } from "@/lib/shared/types";
import { toIso } from "@/lib/server/serialization";
import {
  validateDateOrder,
  validateTournamentInput,
  type ValidatedTournamentInput,
} from "./validation";
import { insertPhases } from "./phases-repository";
import { retryOnDeadlock } from "./deadlock-retry";
import { publishUpdatedEvent } from "./notifications";
import { invalidateSpectatorSnapshot } from "./snapshot";
import { assertMapPointsUnlocked } from "./map-points";
import { queueRoundMapsNotice, roundPointsFingerprint, scheduleRoundMapsNotice } from "./round-maps-notice";
import {
  bracketFitsFormat,
  clipMapPointTargets,
  parseStoredMapPointTarget,
  parseStoredMapPointTargets,
  serializeMapPointTargets,
} from "@/lib/shared/map-points";
import { roundMaxMaps } from "@/lib/shared/round-plan";

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
  enduranceMaxRounds: number | null;
  /** BG Survie : sortie « hors course » anticipée (option, éteinte par défaut). */
  enduranceEarlyExit: boolean;
  /** Phase de lancement des matchs (option, éteinte par défaut). */
  launchPhase: boolean;
  matchFormat: MatchFormat | null;
  /**
   * Format Duel / Arcade : points qui gagnent une carte (`null` = éteint,
   * `docs/features/DUEL_ARCADE.md`).
   */
  mapPointTarget: number | null;
  /** BG Survie : format de l'arbre final (`null` = celui du tournoi). */
  endurancePlayoffFormat: MatchFormat | null;
  /**
   * Conditions d'inscription, **aplaties** en trois champs éditables et non
   * réunies en objet comme `matchFormat` : ce sont trois réglages indépendants,
   * qu'on ouvre et qu'on durcit séparément, et `checkEditPatch` juge champ par
   * champ.
   */
  registrationDiscordRequirement: PlayerRequirement;
  registrationBlizzardRequirement: PlayerRequirement;
  registrationMinPlayers: number;
  phases: PhaseConfig[] | null;
};

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
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT
      id, name, description, format, game, participant_type, max_teams, state,
      start_visibility_at, registration_open_at, registration_close_at, start_at,
      has_third_place_match,
      survival_rounds_before_first_cut, survival_rounds_per_cut,
      swiss_total_rounds, swiss_points_win, swiss_points_draw, swiss_points_loss,
      endurance_start_points, endurance_win_delta, endurance_loss_delta,
      endurance_playoff_size, endurance_max_rounds, endurance_early_exit,
      match_format_type, match_format_value,
      match_format_max_maps, match_format_draws,
      endurance_playoff_format_type, endurance_playoff_format_value,
      registration_discord_requirement, registration_blizzard_requirement,
      registration_min_players, referee_scheduling, match_launch_phase,
      team_voice_channels, map_point_target
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
  const filters = parseRegistrationFilters(
    row.registration_discord_requirement,
    row.registration_min_players,
    row.registration_blizzard_requirement,
  );
  return {
    name: String(row.name),
    description: row.description === null ? null : String(row.description), // NOSONAR typescript:S6551 — colonne texte lue par mysql2, jamais un objet
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
    enduranceMaxRounds: num(row.endurance_max_rounds),
    enduranceEarlyExit: Number(row.endurance_early_exit) === 1,
    launchPhase: Number(row.match_launch_phase) === 1,
    mapPointTarget: parseStoredMapPointTarget(row.map_point_target),
    matchFormat: parseMatchFormat(
      row.match_format_type,
      row.match_format_value,
      row.match_format_max_maps,
      row.match_format_draws,
    ),
    endurancePlayoffFormat: parseMatchFormat(
      row.endurance_playoff_format_type,
      row.endurance_playoff_format_value,
    ),
    registrationDiscordRequirement: filters.discordRequirement,
    registrationBlizzardRequirement: filters.blizzardRequirement,
    registrationMinPlayers: filters.minPlayers,
    phases,
  };
}

/** Phases d'un tournoi MULTI, sous la forme attendue par le formulaire. */
async function loadPhaseConfigs(
  connection: PoolConnection,
  tournamentId: number,
): Promise<PhaseConfig[]> {
  const [rows] = await connection.execute<RowDataPacket[]>(
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
    name: row.name === null ? null : String(row.name), // NOSONAR typescript:S6551 — colonne texte lue par mysql2, jamais un objet
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

/**
 * Lecture d'édition : fenêtre, valeurs du formulaire, et l'option de
 * planification par l'arbitrage — à part des valeurs éditables, parce qu'elle
 * ne passe **pas** par `PATCH .../edit` : elle se bascule par sa route dédiée
 * (`PUT /api/admin/tournaments/[id]/referee-scheduling`) jusqu'à la clôture,
 * bien après que la fenêtre d'édition s'est fermée. `state` dit au formulaire
 * si elle est encore modifiable, et si l'allumer défera des lancements.
 */
export type EditableTournamentLoad = {
  window: EditWindow;
  values: EditableTournamentValues;
  state: TournamentState;
  refereeScheduling: boolean;
  /** Salons vocaux d'équipe — route dédiée `voice-channels`, comme la planification. */
  teamVoiceChannels: boolean;
};

export async function loadEditableTournament(
  tournamentId: number,
): Promise<EditableTournamentLoad | null> {
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
      state: row.state as TournamentState,
      refereeScheduling: Boolean(row.referee_scheduling),
      teamVoiceChannels: Number(row.team_voice_channels) === 1,
    };
  } finally {
    connection.release();
  }
}

/**
 * Points par carte changés : refusé si un match du tournoi porte déjà un score
 * (`MAP_POINTS_LOCKED`) — garde-fou, la fenêtre d'édition se ferme en principe
 * avant le premier match (`docs/features/DUEL_ARCADE.md`).
 */
async function assertPointTargetChangeAllowed(
  connection: PoolConnection,
  tournamentId: number,
  before: number | null,
  after: number | null,
): Promise<void> {
  if (after !== before) await assertMapPointsUnlocked(connection, tournamentId, null);
}

/**
 * Points propres aux tours (format Duel / Arcade) que l'édition rend caducs :
 * **tous** quand le format est éteint — gardés, ils resurgiraient sans que
 * l'écran des cartes les montre (il ne les règle que format allumé) le jour où
 * le format serait rallumé avec un autre N —, sinon ceux d'un tour que le
 * nouveau format (ou les nouvelles phases d'un MULTI, ou la petite finale
 * retirée) ne jouera plus (`bracketFitsFormat`), lignes orphelines portées par
 * chaque instantané. Le contrôle `MAP_POINTS_LOCKED` a déjà eu lieu sous le
 * verrou du tournoi. Une ligne qui ne portait que ces points disparaît ; chaque
 * tour effacé est annoncé au journal du staff, comme un retrait par la route
 * des points d'un tour (`setRoundPointTarget`).
 *
 * @returns `true` si un réglage a été effacé (annonce à planifier au commit).
 */
async function pruneRoundPointTargets(
  connection: PoolConnection,
  tournamentId: number,
  change: {
    turnedOff: boolean;
    structureChanged: boolean;
    matchFormatChanged: boolean;
    format: TournamentFormat;
    hasThirdPlaceMatch: boolean;
    /** Cartes au plus d'un match du tour `roundNumber` sous le format édité (`roundMaxMaps`). */
    maxMaps: (roundNumber: number) => number | null;
  },
): Promise<boolean> {
  if (!change.turnedOff && !change.structureChanged && !change.matchFormatChanged) return false;
  const [rows] = await connection.execute<
    (RowDataPacket & {
      phase_id: number;
      bracket: string;
      round_number: number;
      map_point_target: number | null;
      map_point_targets?: string | null;
    })[]
  >(
    `SELECT phase_id, bracket, round_number, map_point_target, map_point_targets FROM bg_tournament_round_maps
      WHERE tournament_id = ? AND (map_point_target IS NOT NULL OR map_point_targets IS NOT NULL)`,
    [tournamentId],
  );
  let doomed = rows;
  let shortened: { row: (typeof rows)[number]; targets: (number | null)[] }[] = [];
  if (change.turnedOff) {
    await connection.execute(
      `UPDATE bg_tournament_round_maps SET map_point_target = NULL, map_point_targets = NULL
        WHERE tournament_id = ? AND (map_point_target IS NOT NULL OR map_point_targets IS NOT NULL)`,
      [tournamentId],
    );
  } else {
    const fits = change.structureChanged
      ? await roundFitter(connection, tournamentId, change.format, change.hasThirdPlaceMatch)
      : () => true;
    doomed = rows.filter((row) => !fits(Number(row.phase_id), String(row.bracket)));
    shortened = shortenedMapTargets(
      rows.filter((row) => fits(Number(row.phase_id), String(row.bracket))),
      change.maxMaps,
    );
    if (doomed.length === 0 && shortened.length === 0) return false;
    await writePrunedRoundTargets(connection, tournamentId, doomed, shortened);
  }
  await connection.execute(
    `DELETE FROM bg_tournament_round_maps
      WHERE tournament_id = ? AND slots_json = '[]' AND tiebreak_map IS NULL AND map_point_target IS NULL
        AND map_point_targets IS NULL`,
    [tournamentId],
  );
  const announced = [...doomed, ...shortened.map((item) => item.row)];
  await queueRoundMapsNotice(
    connection,
    tournamentId,
    announced.map((row) => ({
      phaseId: Number(row.phase_id),
      bracket: String(row.bracket),
      roundNumber: Number(row.round_number),
      before: roundPointsFingerprint(
        parseStoredMapPointTarget(row.map_point_target),
        parseStoredMapPointTargets(row.map_point_targets),
      ),
    })),
    { points: true },
  );
  return announced.length > 0;
}

type RoundKeyRow = { phase_id: number; bracket: string; round_number: number };

/** Écrit l'élagage : réglages des tours caducs retirés, réglages carte par carte raccourcis. */
async function writePrunedRoundTargets(
  connection: PoolConnection,
  tournamentId: number,
  doomed: readonly RoundKeyRow[],
  shortened: readonly { row: RoundKeyRow; targets: (number | null)[] }[],
): Promise<void> {
  // Une seule instruction pour tous les tours caducs : le verrou du tournoi
  // n'attend pas R allers-retours.
  if (doomed.length > 0) {
    await connection.execute(
      `UPDATE bg_tournament_round_maps SET map_point_target = NULL, map_point_targets = NULL
        WHERE tournament_id = ? AND (${doomed.map(() => "(phase_id = ? AND bracket = ? AND round_number = ?)").join(" OR ")})`,
      [tournamentId, ...doomed.flatMap((row) => [row.phase_id, row.bracket, row.round_number])],
    );
  }
  // Une seule instruction (CASE) pour tous les tours raccourcis, comme `doomed`.
  if (shortened.length > 0) {
    const key = "(phase_id = ? AND bracket = ? AND round_number = ?)";
    await connection.execute(
      `UPDATE bg_tournament_round_maps
          SET map_point_targets = CASE ${shortened.map(() => `WHEN ${key} THEN ?`).join(" ")} ELSE map_point_targets END
        WHERE tournament_id = ? AND (${shortened.map(() => key).join(" OR ")})`,
      [
        ...shortened.flatMap(({ row, targets }) => [
          row.phase_id,
          row.bracket,
          row.round_number,
          serializeMapPointTargets(targets),
        ]),
        tournamentId,
        ...shortened.flatMap(({ row }) => [row.phase_id, row.bracket, row.round_number]),
      ],
    );
  }
}

/**
 * Un format de match raccourci (BO3 → BO1) : les cartes qu'il ne joue plus
 * perdent leur réglage propre, sans quoi chaque écran le citerait encore.
 */
function shortenedMapTargets<R extends { round_number: number; map_point_targets?: string | null }>(
  rows: readonly R[],
  maxMaps: (roundNumber: number) => number | null,
): { row: R; targets: (number | null)[] }[] {
  return rows.flatMap((row) => {
    const stored = parseStoredMapPointTargets(row.map_point_targets);
    const kept = clipMapPointTargets(stored, maxMaps(Number(row.round_number)));
    return kept.length === stored.length ? [] : [{ row, targets: kept }];
  });
}

function sameMatchFormat(a: MatchFormat | null, b: MatchFormat | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.type === b.type &&
    a.value === b.value &&
    (a.maxMaps ?? null) === (b.maxMaps ?? null) &&
    Boolean(a.drawsAllowed) === Boolean(b.drawsAllowed)
  );
}

/** Ce que l'édition change pour les points propres aux tours (`pruneRoundPointTargets`). */
function roundPointsChange(
  patch: Partial<EditableTournamentValues>,
  current: Pick<
    EditableTournamentValues,
    "mapPointTarget" | "format" | "hasThirdPlaceMatch" | "matchFormat" | "endurancePlayoffFormat"
  >,
  valid: Pick<
    ValidatedTournamentInput,
    "mapPointTarget" | "format" | "hasThirdPlaceMatch" | "matchFormat" | "endurancePlayoffFormat"
  >,
): Parameters<typeof pruneRoundPointTargets>[2] {
  return {
    turnedOff: valid.mapPointTarget === null && current.mapPointTarget !== null,
    // Valeurs comparées, pas présence dans le patch : un formulaire qui renvoie
    // toujours ces champs ne déclenche pas le balayage des tours à chaque édition.
    structureChanged:
      (patch.format !== undefined && patch.format !== current.format) ||
      patch.phases !== undefined ||
      (patch.hasThirdPlaceMatch !== undefined && patch.hasThirdPlaceMatch !== current.hasThirdPlaceMatch),
    matchFormatChanged:
      (patch.format !== undefined && patch.format !== current.format) ||
      (patch.matchFormat !== undefined && !sameMatchFormat(patch.matchFormat, current.matchFormat)) ||
      (patch.endurancePlayoffFormat !== undefined &&
        !sameMatchFormat(patch.endurancePlayoffFormat, current.endurancePlayoffFormat)),
    format: valid.format,
    hasThirdPlaceMatch: valid.hasThirdPlaceMatch,
    maxMaps: (roundNumber) => roundMaxMaps(valid, roundNumber),
  };
}

/** Tour (phase, tableau) que le tournoi édité jouera encore. */
async function roundFitter(
  connection: PoolConnection,
  tournamentId: number,
  format: TournamentFormat,
  hasThirdPlaceMatch: boolean,
): Promise<(phaseId: number, bracket: string) => boolean> {
  if (format !== "MULTI") {
    return (phaseId, bracket) => phaseId === 0 && bracketFitsFormat(format, bracket, hasThirdPlaceMatch);
  }
  const [phases] = await connection.execute<
    (RowDataPacket & { id: number; format: PhaseFormat; has_third_place_match: number | boolean | null })[]
  >(`SELECT id, format, has_third_place_match FROM bg_tournament_phases WHERE tournament_id = ?`, [tournamentId]);
  const byId = new Map(phases.map((phase) => [Number(phase.id), phase]));
  return (phaseId, bracket) => {
    const phase = byId.get(phaseId);
    return phase !== undefined && bracketFitsFormat(phase.format, bracket, Boolean(Number(phase.has_third_place_match)));
  };
}

/**
 * Applique un patch d'édition. Rend le nom du tournoi **d'avant** et celui
 * qu'il vient d'écrire, lus sous le verrou de la ligne : le journal du staff
 * cite l'un et nomme le tournoi sous l'autre, même si un second renommage
 * suit avant que sa ligne parte.
 */
export function updateTournament(
  tournamentId: number,
  patch: Partial<EditableTournamentValues>,
): Promise<{ previousName: string; name: string }> {
  // Le contrôle `MAP_POINTS_LOCKED` verrouille les matchs du tournoi : face à un
  // report en cours, l'ordre des verrous peut s'inverser. L'interblocage se
  // rejoue (transaction annulée en entier) plutôt que de rendre un 500 au staff.
  return retryOnDeadlock(() => applyTournamentUpdate(tournamentId, patch));
}

async function applyTournamentUpdate(
  tournamentId: number,
  patch: Partial<EditableTournamentValues>,
): Promise<{ previousName: string; name: string }> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  let previousName: string;
  let name: string;
  let roundPointsPruned = false;

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
    previousName = current.name;

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

    const { valid, normalizedPhases } = validateEditedValues(next);
    name = valid.name;
    await assertPointTargetChangeAllowed(connection, tournamentId, current.mapPointTarget, valid.mapPointTarget);

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
        endurance_playoff_size = ?, endurance_max_rounds = ?, endurance_early_exit = ?,
        match_format_type = ?, match_format_value = ?,
        match_format_max_maps = ?, match_format_draws = ?,
        endurance_playoff_format_type = ?, endurance_playoff_format_value = ?,
        registration_discord_requirement = ?, registration_blizzard_requirement = ?,
        registration_min_players = ?, match_launch_phase = ?, map_point_target = ?
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
        valid.enduranceMaxRounds,
        valid.enduranceEarlyExit ? 1 : 0,
        valid.matchFormat?.type ?? null,
        valid.matchFormat?.value ?? null,
        valid.matchFormat?.maxMaps ?? null,
        valid.matchFormat?.drawsAllowed ? 1 : 0,
        valid.endurancePlayoffFormat?.type ?? null,
        valid.endurancePlayoffFormat?.value ?? null,
        valid.registrationFilters.discordRequirement,
        valid.registrationFilters.blizzardRequirement,
        valid.registrationFilters.minPlayers,
        valid.launchPhase ? 1 : 0,
        valid.mapPointTarget,
        tournamentId,
      ],
    );

    // Les phases ne sont reposées à neuf que si le patch les concerne — soit
    // directement, soit par un changement de format qui les rend caduques.
    // Renommer un tournoi MULTI ne touchait pas moins ses phases : le
    // DELETE + INSERT était inconditionnel, pour un résultat identique à
    // l'octet près.
    //
    // L'invariant qui rend ce DELETE sûr repose sur l'état du tournoi. Seules
    // les fonctions de démarrage (initializeMultiTournament, startPhase) et le
    // recalcul du seeding écrivent une phase_id, et toutes exigent
    // state === "RUNNING". Or on a jeté TOURNAMENT_LOCKED plus haut si l'état
    // était RUNNING : aucune phase n'est donc en cours d'usage ici. Il n'y a pas
    // de clé étrangère pour protéger cet invariant — une réduction future du
    // verrou sur l'édition pourrait le briser silencieusement. Ne plus y toucher
    // hors de propos réduit d'autant la surface de cette dépendance.
    if (patch.format !== undefined || patch.phases !== undefined) {
      await connection.execute(`DELETE FROM bg_tournament_phases WHERE tournament_id = ?`, [
        tournamentId,
      ]);
      if (valid.format === "MULTI" && normalizedPhases) {
        await insertPhases(connection, tournamentId, normalizedPhases);
      }
    }
    roundPointsPruned = await pruneRoundPointTargets(connection, tournamentId, roundPointsChange(patch, current, valid));

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  // La page sans compte ne garde ni sa réponse publique ni sa carte d'encart :
  // un nom ou une description retirés par le staff (insulte, coordonnées)
  // restaient sinon servis en aperçu jusqu'à 150 s (copie) et 10 s (carte).
  // Une édition est un geste rare du staff : une reconstruction de plus.
  invalidateSpectatorSnapshot(tournamentId);
  publishUpdatedEvent(tournamentId);
  scheduleRoundPointsNotice(roundPointsPruned);
  return { previousName, name };
}

/** Points de tour effacés par l'édition : leur annonce part une fois le commit fait. */
function scheduleRoundPointsNotice(pruned: boolean): void {
  if (pruned) scheduleRoundMapsNotice();
}

/**
 * Valide les valeurs **résultantes** d'une édition — champs modifiés et champs
 * conservés mêlés — par les mêmes règles que la création.
 */
function validateEditedValues(next: EditableTournamentValues): {
  valid: ValidatedTournamentInput;
  normalizedPhases: PhaseConfig[] | null;
} {
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
    enduranceMaxRounds: next.enduranceMaxRounds ?? undefined,
    enduranceEarlyExit: next.enduranceEarlyExit,
    launchPhase: next.launchPhase,
    mapPointTarget: next.mapPointTarget,
    matchFormatType: next.matchFormat?.type ?? null,
    matchFormatValue: next.matchFormat?.value ?? null,
    matchFormatMaxMaps: next.matchFormat?.maxMaps ?? null,
    matchFormatDraws: next.matchFormat?.drawsAllowed ?? null,
    endurancePlayoffFormatType: next.endurancePlayoffFormat?.type ?? null,
    endurancePlayoffFormatValue: next.endurancePlayoffFormat?.value ?? null,
    registrationDiscordRequirement: next.registrationDiscordRequirement,
    registrationBlizzardRequirement: next.registrationBlizzardRequirement,
    registrationMinPlayers: next.registrationMinPlayers,
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
  return { valid, normalizedPhases };
}
