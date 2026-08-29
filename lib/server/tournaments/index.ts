import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { TournamentBuckets, TournamentDetail, TournamentFormat, TournamentState } from "@/lib/shared/types";
import { getDatabase } from "@/lib/server/database";
import { parseMatchFormat, type MatchFormat } from "@/lib/shared/match-format";
import { toIso } from "@/lib/server/serialization";
import { loadSoloUserIds } from "@/lib/server/solo-entries-service";
import { isSoloTournament, toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import { validateDateOrder } from "./validation";
import type { TournamentRow, TournamentListRow } from "./_internal";

// Internal types
export type { TournamentRow, RegistrationRow, MatchRow, TournamentListRow } from "./_internal";
export { mapCard, mapMatch, statusFromTeams } from "./_internal";

// State management
export { computeTournamentState, syncTournamentState, hasPendingStateTransition } from "./state";

// Registration (registerCurrentUserTeam is wrapped as public API function)
export { canUserRegister, resolveUserEntrantTeamId } from "./registration";

// Bracket generation
export { createBracketIfMissing } from "./bracket-generator";

// Scoring
export { reportMatchScore, finalizeMatch } from "./scoring";

// Admin (adminResolveMatch is wrapped as public API function)
export { adminSaveMatchScores, checkDownstreamMatchesHaveNoScores } from "./admin";

// Notifications
export { publishUpdatedEvent, publishScoreReportedEvent, publishScoreResolvedEvent, sendBotLogAsync } from "./notifications";

// Repository
export {
  loadTournamentRow,
  loadRegisteredTeamIds,
  createMatch,
  setMatchParticipants,
  updateTournamentState,
  updateTournamentBracketSize,
  finishTournament,
  getRegistrationRows,
  getMatchRows,
  getTournamentListRow,
  hasExistingMatches,
  deleteAllMatches,
  resetRegistrationRanks,
} from "./repository";

// Byes
export { tryAutoResolveByes } from "./byes";

// Finalization
export { finalizeTournamentIfDone, resolveExpiredScoreReports } from "./finalization";

// Swiss
export {
  initializeSwissTournament,
  generateSwissRound,
  reconcileSwiss,
  forfeitSwissTeam,
  loadSwissMeta,
} from "./swiss";

// Survival
export {
  initializeSurvivalTournament,
  generateSurvivalRound,
  reconcileSurvival,
  forfeitSurvivalTeam,
  loadSurvivalMeta,
} from "./survival";

// BlueGenji Survie (endurance)
export {
  initializeEnduranceTournament,
  generateEnduranceRound,
  reconcileEndurance,
  startEndurancePlayoffs,
  forfeitEnduranceTeam,
  loadEnduranceMeta,
} from "./bg-survie";

// Phases (Multi)
export {
  initializeMultiTournament,
  startPhase,
  reconcilePhases,
  finalizeMultiTournament,
  loadPhasesForDetail,
} from "./phases";

// Public API functions
import { syncTournamentState } from "./state";
import {
  registerCurrentUserTeam as registerTeamInternal,
  registerTeamById as registerTeamByIdInternal,
  resolveUserEntrantTeamId,
} from "./registration";
import { resolveExpiredScoreReports, finalizeTournamentIfDone } from "./finalization";
import { tryAutoResolveByes } from "./byes";
import { mapCard, mapMatch } from "./_internal";
import { getTournamentListRow, getRegistrationRows, getMatchRows, loadTournamentRow } from "./repository";
import { reportMatchScore } from "./scoring";
import { publishUpdatedEvent, publishScoreReportedEvent, publishScoreResolvedEvent, sendBotLogAsync } from "./notifications";

let pendingSync: Promise<void> | null = null;
let lastSyncAt = 0;
const SYNC_THROTTLE_MS = 1000;

async function syncVisibleTournaments(): Promise<void> {
  if (pendingSync) return pendingSync;
  if (Date.now() - lastSyncAt < SYNC_THROTTLE_MS) return;

  pendingSync = (async () => {
    const db = await getDatabase();
    const connection = await db.getConnection();
    const changedIds: number[] = [];

    try {
      await connection.beginTransaction();

      const [rows] = await connection.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM bg_tournaments WHERE state <> 'FINISHED'`,
      );

      for (const row of rows) {
        const { stateChanged } = await syncTournamentState(connection, Number(row.id));
        if (stateChanged) changedIds.push(Number(row.id));
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    for (const id of changedIds) {
      publishUpdatedEvent(id);
    }
  })();

  try {
    await pendingSync;
  } finally {
    lastSyncAt = Date.now();
    pendingSync = null;
  }
}

export async function createTournament(
  organizerUserId: number,
  payload: {
    name: string;
    description: string | null;
    format: TournamentFormat;
    game?: "OW2" | "MR";
    /** `SOLO` = tournoi individuel (défaut `TEAM`). */
    participantType?: ParticipantType;
    maxTeams: number;
    startVisibilityAt: string;
    registrationOpenAt: string;
    registrationCloseAt: string;
    startAt: string;
    hasThirdPlaceMatch?: boolean;
    survivalRoundsBeforeFirstCut?: number | null;
    survivalRoundsPerCut?: number | null;
    swissTotalRounds?: number | null;
    swissPointsWin?: number | null;
    swissPointsDraw?: number | null;
    swissPointsLoss?: number | null;
    /** Format des matchs (BO5, FT3…) ; `null` = saisie de score libre. */
    matchFormat?: MatchFormat | null;
    /** BlueGenji Survie : capital d'endurance et barème (null = défauts). */
    endurancePoints?: number | null;
    enduranceWinDelta?: number | null;
    enduranceLossDelta?: number | null;
    endurancePlayoffSize?: number | null;
    phases?: Array<{
      position: number;
      format: "SINGLE" | "DOUBLE" | "SWISS" | "SURVIVAL";
      name: string | null;
      qualifierMode: "COUNT" | "PERCENT";
      qualifierValue: number;
      hasThirdPlaceMatch: boolean;
      swissTotalRounds: number | null;
      survivalRoundsBeforeFirstCut: number | null;
      survivalRoundsPerCut: number | null;
    }>;
  },
): Promise<number> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const dateError = validateDateOrder({
      startVisibilityAt: payload.startVisibilityAt,
      registrationOpenAt: payload.registrationOpenAt,
      registrationCloseAt: payload.registrationCloseAt,
      startAt: payload.startAt,
    });
    if (dateError) throw new Error(dateError);

    const startVisibilityAt = new Date(payload.startVisibilityAt);
    const registrationOpenAt = new Date(payload.registrationOpenAt);
    const registrationCloseAt = new Date(payload.registrationCloseAt);
    const startAt = new Date(payload.startAt);

    const { computeTournamentState } = await import("./state");

    const temporaryState: TournamentState = computeTournamentState({
      state: "UPCOMING",
      finished_at: null,
      registration_open_at: registrationOpenAt,
      registration_close_at: registrationCloseAt,
      start_at: startAt,
    });

    const hasThirdPlaceMatch = payload.format === "SINGLE" && Boolean(payload.hasThirdPlaceMatch);
    const game = payload.game ?? "OW2";
    const participantType = toParticipantType(payload.participantType);

    // Mode Survie : cadence des coupes (min. 1 manche). Ignorée pour les autres
    // formats. Le délai avant la première coupe retombe sur l'intervalle courant
    // s'il n'est pas fourni.
    const survivalRoundsPerCut =
      payload.format === "SURVIVAL"
        ? Math.max(1, Math.trunc(Number(payload.survivalRoundsPerCut ?? 1)))
        : null;
    const survivalRoundsBeforeFirstCut =
      payload.format === "SURVIVAL"
        ? Math.max(
            1,
            Math.trunc(Number(payload.survivalRoundsBeforeFirstCut ?? survivalRoundsPerCut ?? 1)),
          )
        : null;

    // Mode Suisse : nombre de rondes et barème. `null` laisse le moteur retomber
    // sur la recommandation ⌈log₂(N)⌉ + 1, calculée au démarrage quand l'effectif
    // définitif est connu.
    const isSwiss = payload.format === "SWISS";
    const swissTotalRounds =
      isSwiss && payload.swissTotalRounds != null
        ? Math.max(1, Math.trunc(Number(payload.swissTotalRounds)))
        : null;
    const swissPoints = (value: number | null | undefined, fallback: number): number =>
      isSwiss && value != null ? Math.max(0, Math.trunc(Number(value))) : fallback;

    // Format des matchs : revalidé ici pour que le service reste sûr même
    // appelé hors de la route HTTP (seed, scripts). Un format bancal retombe
    // sur la saisie libre plutôt que d'être écrit en base.
    const matchFormat = parseMatchFormat(
      payload.matchFormat?.type ?? null,
      payload.matchFormat?.value ?? null,
    );

    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bg_tournaments (
        organizer_user_id,
        name,
        description,
        format,
        game,
        participant_type,
        max_teams,
        state,
        start_visibility_at,
        registration_open_at,
        registration_close_at,
        start_at,
        has_third_place_match,
        survival_rounds_before_first_cut,
        survival_rounds_per_cut,
        swiss_total_rounds,
        swiss_points_win,
        swiss_points_draw,
        swiss_points_loss,
        swiss_points_bye,
        endurance_start_points,
        endurance_win_delta,
        endurance_loss_delta,
        endurance_playoff_size,
        match_format_type,
        match_format_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        organizerUserId,
        payload.name.trim(),
        payload.description,
        payload.format,
        game,
        participantType,
        payload.maxTeams,
        temporaryState,
        startVisibilityAt,
        registrationOpenAt,
        registrationCloseAt,
        startAt,
        hasThirdPlaceMatch ? 1 : 0,
        survivalRoundsBeforeFirstCut,
        survivalRoundsPerCut,
        swissTotalRounds,
        swissPoints(payload.swissPointsWin, 3),
        swissPoints(payload.swissPointsDraw, 1),
        swissPoints(payload.swissPointsLoss, 0),
        // Une victoire d'office vaut exactement une victoire : sans quoi le bye
        // deviendrait un avantage (ou une punition) selon le barème choisi.
        swissPoints(payload.swissPointsWin, 3),
        // BlueGenji Survie : `null` laisse le moteur appliquer 9 / ±1 / 8 au
        // démarrage, puis fige les valeurs effectives sur le tournoi.
        payload.endurancePoints ?? null,
        payload.enduranceWinDelta ?? null,
        payload.enduranceLossDelta ?? null,
        payload.endurancePlayoffSize ?? null,
        // Les deux colonnes vont par paire : une seule renseignée décrirait un
        // format incomplet, que `parseMatchFormat` relirait comme « libre ».
        matchFormat?.type ?? null,
        matchFormat?.value ?? null,
      ],
    );

    const tournamentId = Number(insert.insertId);

    // Valide et insère les phases si format MULTI
    if (payload.format === "MULTI" && payload.phases) {
      // Le payload HTTP ne porte pas les positions (c'est l'ordre du tableau qui
      // fait foi) : on normalise avant de valider et d'insérer.
      const { normalizePhaseConfigs, validatePhases } = await import(
        "@/lib/shared/tournament-phases"
      );
      const phases = normalizePhaseConfigs(payload.phases);

      const error = validatePhases(phases);
      if (error) {
        throw new Error(error);
      }

      const { insertPhases } = await import("./phases-repository");
      await insertPhases(connection, tournamentId, phases);
    }

    await connection.commit();
    return tournamentId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listTournamentBuckets(searchTerm: string | null): Promise<TournamentBuckets> {
  await syncVisibleTournaments();

  const db = await getDatabase();
  const now = new Date();

  const where: string[] = [`t.start_visibility_at <= ?`];
  const params: unknown[] = [now];

  if (searchTerm && searchTerm.trim()) {
    where.push(`LOWER(t.name) LIKE ?`);
    params.push(`%${searchTerm.trim().toLowerCase()}%`);
  }

  const [rows] = await db.execute<TournamentListRow[]>(
    `SELECT
      t.id,
      t.name,
      t.description,
      t.format,
      t.game,
      t.max_teams,
      t.state,
      t.start_visibility_at,
      t.registration_open_at,
      t.registration_close_at,
      t.start_at,
      t.bracket_size,
      t.created_at,
      t.organizer_user_id,
      t.finished_at,
      t.has_third_place_match,
      t.survival_rounds_before_first_cut,
      t.survival_rounds_per_cut,
      t.survival_current_round,
      t.participant_type,
      t.match_format_type,
      t.match_format_value,
      COALESCE(COUNT(r.id), 0) AS registered_teams
     FROM bg_tournaments t
     LEFT JOIN bg_tournament_registrations r ON r.tournament_id = t.id
     WHERE ${where.join(" AND ")}
     GROUP BY
      t.id,
      t.name,
      t.description,
      t.format,
      t.game,
      t.max_teams,
      t.state,
      t.start_visibility_at,
      t.registration_open_at,
      t.registration_close_at,
      t.start_at,
      t.bracket_size,
      t.created_at,
      t.organizer_user_id,
      t.finished_at,
      t.has_third_place_match,
      t.survival_rounds_before_first_cut,
      t.survival_rounds_per_cut,
      t.survival_current_round,
      t.participant_type,
      t.match_format_type,
      t.match_format_value
     ORDER BY t.start_at DESC`,
    params,
  );

  const buckets: TournamentBuckets = {
    upcoming: [],
    registration: [],
    running: [],
    finished: [],
  };

  for (const row of rows) {
    const card = mapCard(row);
    if (row.state === "UPCOMING") buckets.upcoming.push(card);
    if (row.state === "REGISTRATION") buckets.registration.push(card);
    if (row.state === "RUNNING") buckets.running.push(card);
    if (row.state === "FINISHED") buckets.finished.push(card);
  }

  return buckets;
}

export async function registerCurrentUserTeam(tournamentId: number, userId: number): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await registerTeamInternal(connection, tournamentId, userId);
    await connection.commit();

    publishUpdatedEvent(tournamentId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Engagé du joueur dans un tournoi, vu de l'extérieur du module (routes API) :
 * son équipe active, ou son entrée solo si le tournoi est individuel. `null`
 * signifie « rien à engager » — un tournoi inconnu lève, pour que l'appelant
 * puisse répondre 404 plutôt que de parler d'équipe manquante.
 *
 * @throws TOURNAMENT_NOT_FOUND
 */
export async function getUserEntrantTeamId(
  tournamentId: number,
  userId: number,
): Promise<number | null> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    const tournament = await loadTournamentRow(connection, tournamentId);
    if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
    return await resolveUserEntrantTeamId(connection, tournament, userId);
  } finally {
    connection.release();
  }
}

/**
 * Inscrit une équipe fantôme au nom du staff. L'appelant (route API) vérifie la
 * permission `tournaments` et le caractère fantôme de l'équipe.
 */
export async function registerGhostTeam(tournamentId: number, teamId: number): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await registerTeamByIdInternal(connection, tournamentId, teamId);
    await connection.commit();

    publishUpdatedEvent(tournamentId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function hasExpiredScoreReports(
  db: Awaited<ReturnType<typeof getDatabase>>,
  tournamentId: number,
): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_matches WHERE tournament_id = ? AND status = 'AWAITING_CONFIRMATION' AND score_deadline_at <= NOW() LIMIT 1`,
    [tournamentId],
  );
  return rows.length > 0;
}

export async function getTournamentDetail(
  tournamentId: number,
  userId: number,
  isAdmin = false,
): Promise<TournamentDetail | null> {
  const db = await getDatabase();

  let tournamentRow: TournamentRow | null;
  const detailConnection = await db.getConnection();
  try {
    tournamentRow = await loadTournamentRow(detailConnection, tournamentId);
  } finally {
    detailConnection.release();
  }
  if (!tournamentRow) return null;

  const { hasPendingStateTransition } = await import("./state");

  const needsSync =
    tournamentRow.state === "RUNNING" &&
    (tournamentRow.bracket_size === null ||
      (await hasExpiredScoreReports(db, tournamentId)) ||
      (await hasPendingStateTransition(tournamentRow)));

  let tournament: TournamentRow | null = tournamentRow;
  if (needsSync) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const syncResult = await syncTournamentState(connection, tournamentId);
      tournament = syncResult.row;
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  if (!tournament) {
    return null;
  }

  const connection = await db.getConnection();
  try {
    const cardRow = await getTournamentListRow(connection, tournamentId);
    if (!cardRow) return null;

    const card = mapCard(cardRow);
    const registrations = await getRegistrationRows(connection, tournamentId);
    const matches = await getMatchRows(connection, tournamentId);

    // Engagé du viewer : son équipe active, ou son entrée solo en individuel.
    const myTeamId = await resolveUserEntrantTeamId(connection, tournament, userId);
    const isSolo = isSoloTournament(tournament.participant_type);
    const alreadyRegistered =
      myTeamId !== null && registrations.some((row) => Number(row.team_id) === myTeamId);
    const canRegister =
      card.state === "REGISTRATION" &&
      !alreadyRegistered &&
      // En individuel, un joueur sans entrée solo peut s'inscrire : elle sera
      // créée à ce moment-là.
      (isSolo || myTeamId !== null);

    const canCreateReportsForTeamIds = myTeamId ? [myTeamId] : [];

    // Engagés qui sont des joueurs : l'interface lie alors vers leur profil.
    const soloUserIds = isSolo
      ? await loadSoloUserIds(
          connection,
          registrations.map((row) => Number(row.team_id)),
        )
      : {};

    const phasesDetail = card.format === "MULTI"
      ? await (await import("./phases")).loadPhasesForDetail(connection, tournamentId)
      : null;

    // La vue Survie sert aussi à l'intérieur d'un tournoi multi-phases : sans
    // ces métadonnées, une phase en survie retomberait sur l'affichage générique
    // en arbre, privant les équipes du classement et du report de score.
    const survivalPhaseId =
      phasesDetail?.phases.find(
        (phase) => phase.id === phasesDetail.currentPhaseId && phase.format === "SURVIVAL",
      )?.id ?? null;

    const survival =
      card.format === "SURVIVAL"
        ? await (await import("./survival")).loadSurvivalMeta(connection, tournamentId)
        : survivalPhaseId !== null
          ? await (await import("./survival")).loadSurvivalMeta(
              connection,
              tournamentId,
              survivalPhaseId,
            )
          : null;

    // Même raison que pour la survie ci-dessus : la vue Suisse sert aussi à
    // l'intérieur d'une phase, sinon une ronde suisse en `MULTI` n'afficherait
    // ni classement ni départages.
    const swissPhaseId =
      phasesDetail?.phases.find(
        (phase) => phase.id === phasesDetail.currentPhaseId && phase.format === "SWISS",
      )?.id ?? null;

    const endurance =
      card.format === "BG_SURVIE"
        ? await (await import("./bg-survie")).loadEnduranceMeta(connection, tournamentId)
        : null;

    const swiss =
      card.format === "SWISS"
        ? await (await import("./swiss")).loadSwissMeta(connection, tournamentId)
        : swissPhaseId !== null
          ? await (await import("./swiss")).loadSwissMeta(connection, tournamentId, swissPhaseId)
          : null;

    return {
      card,
      matches: matches.map(mapMatch),
      registrations: registrations.map((row) => ({
        teamId: Number(row.team_id),
        teamName: row.team_name,
        logoUrl: row.logo_url,
        seed: row.seed === null ? null : Number(row.seed),
        registeredAt: toIso(row.registered_at)!,
        finalRank: row.final_rank === null ? null : Number(row.final_rank),
      })),
      canRegister,
      myTeamId,
      canCreateReportsForTeamIds,
      isAdmin,
      survival,
      swiss,
      endurance,
      phases: phasesDetail?.phases ?? null,
      currentPhaseId: phasesDetail?.currentPhaseId ?? null,
      phaseStandings: phasesDetail?.phaseStandings ?? {},
      soloUserIds,
    };
  } finally {
    connection.release();
  }
}

export async function reportMatchScorePublic(
  tournamentId: number,
  matchId: number,
  userId: number,
  myScoreRaw: number,
  opponentScoreRaw: number,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  let pendingBotLog: string | null = null;

  try {
    await connection.beginTransaction();

    pendingBotLog = await reportMatchScore(
      connection,
      tournamentId,
      matchId,
      userId,
      myScoreRaw,
      opponentScoreRaw,
    );

    await resolveExpiredScoreReports(connection, tournamentId);
    await tryAutoResolveByes(connection, tournamentId);

    // Réconcilie les modes à classement (idempotents) avant la finalisation
    // générique. Chacun sort immédiatement si le format ne le concerne pas.
    const { reconcileSurvival } = await import("./survival");
    await reconcileSurvival(tournamentId, connection);
    const { reconcileSwiss } = await import("./swiss");
    await reconcileSwiss(tournamentId, connection);
    const { reconcileEndurance } = await import("./bg-survie");
    await reconcileEndurance(tournamentId, connection);

    // Réconcilie les phases multi (idempotent)
    const { reconcilePhases: reconcileMultiPhases } = await import("./phases");
    await reconcileMultiPhases(tournamentId, connection);

    await finalizeTournamentIfDone(connection, tournamentId);

    await connection.commit();

    publishScoreReportedEvent(tournamentId, matchId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    if (pendingBotLog) {
      await sendBotLogAsync(pendingBotLog);
    }
  }
}

export async function adminSaveMatchScoresPublic(
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { adminSaveMatchScores: adminSaveInternal } = await import("./admin");
    await adminSaveInternal(connection, matchId, team1Score, team2Score, forfeitTeamId);

    // Need to get tournament ID for event + Survival reconciliation
    const [matchData] = await connection.execute<(RowDataPacket & { tournament_id: number })[]>(
      `SELECT tournament_id FROM bg_matches WHERE id = ? LIMIT 1`,
      [matchId],
    );
    const savedTournamentId = matchData.length > 0 ? Number(matchData[0].tournament_id) : null;

    if (savedTournamentId !== null) {
      const { reconcileSurvival } = await import("./survival");
      await reconcileSurvival(savedTournamentId, connection);
      const { reconcileSwiss } = await import("./swiss");
      await reconcileSwiss(savedTournamentId, connection);
      const { reconcileEndurance } = await import("./bg-survie");
      await reconcileEndurance(savedTournamentId, connection);

      const { reconcilePhases: reconcileMultiPhases } = await import("./phases");
      await reconcileMultiPhases(savedTournamentId, connection);
    }

    await connection.commit();

    if (savedTournamentId !== null) {
      publishScoreResolvedEvent(savedTournamentId, matchId);
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Déclare le forfait d'une équipe (elle quitte la compétition). Réservé aux
 * formats à classement — Survie et Ronde suisse : en élimination, le match perdu
 * suffit à sortir une équipe, il n'y a rien à abandonner.
 *
 * Ouvre sa propre transaction et publie l'évènement de mise à jour.
 */
export async function forfeitTournamentTeamPublic(
  tournamentId: number,
  teamId: number,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [formatRows] = await connection.execute<(RowDataPacket & { format: string })[]>(
      `SELECT format FROM bg_tournaments WHERE id = ? LIMIT 1`,
      [tournamentId],
    );
    const format = formatRows[0]?.format ?? null;

    // En multi-phases, c'est le format de la PHASE COURANTE qui décide : un
    // abandon garde tout son sens pendant une phase de survie ou de ronde
    // suisse, même si le tournoi lui-même porte le format « MULTI ».
    let engineFormat = format;
    let forfeitPhaseId = 0;

    if (format === "MULTI") {
      const [phaseRows] = await connection.execute<
        (RowDataPacket & { id: number; format: string })[]
      >(
        `SELECT p.id, p.format
         FROM bg_tournament_phases p
         JOIN bg_tournaments t ON t.current_phase_id = p.id
         WHERE t.id = ? LIMIT 1`,
        [tournamentId],
      );
      engineFormat = phaseRows[0]?.format ?? null;
      forfeitPhaseId = Number(phaseRows[0]?.id ?? 0);
    }

    if (engineFormat === "SURVIVAL") {
      const { forfeitSurvivalTeam } = await import("./survival");
      await forfeitSurvivalTeam(tournamentId, teamId, connection, forfeitPhaseId);
    } else if (engineFormat === "SWISS") {
      const { forfeitSwissTeam } = await import("./swiss");
      await forfeitSwissTeam(tournamentId, teamId, connection, forfeitPhaseId);
    } else if (engineFormat === "BG_SURVIE") {
      const { forfeitEnduranceTeam } = await import("./bg-survie");
      await forfeitEnduranceTeam(tournamentId, teamId, connection);
    } else {
      throw new Error("FORMAT_WITHOUT_FORFEIT");
    }

    if (format === "MULTI") {
      const { reconcilePhases } = await import("./phases");
      await reconcilePhases(tournamentId, connection);
    }

    await connection.commit();
    publishUpdatedEvent(tournamentId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function adminResolveMatchPublic(
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Get tournament ID from match
    const [matchData] = await connection.execute<(RowDataPacket & { tournament_id: number })[]>(
      `SELECT tournament_id FROM bg_matches WHERE id = ? LIMIT 1`,
      [matchId],
    );

    if (matchData.length === 0) throw new Error("MATCH_NOT_FOUND");
    const tournamentId = Number(matchData[0].tournament_id);

    const { adminResolveMatch } = await import("./admin");
    await adminResolveMatch(connection, matchId, team1Score, team2Score, forfeitTeamId);

    await tryAutoResolveByes(connection, tournamentId);

    const { reconcileSurvival } = await import("./survival");
    await reconcileSurvival(tournamentId, connection);
    const { reconcileSwiss } = await import("./swiss");
    await reconcileSwiss(tournamentId, connection);
    const { reconcileEndurance } = await import("./bg-survie");
    await reconcileEndurance(tournamentId, connection);

    const { reconcilePhases: reconcileMultiPhases } = await import("./phases");
    await reconcileMultiPhases(tournamentId, connection);

    await finalizeTournamentIfDone(connection, tournamentId);

    await connection.commit();

    publishScoreReportedEvent(tournamentId, matchId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
