import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  TournamentBuckets,
  TournamentDetail,
  TournamentFormat,
  TournamentSnapshot,
  TournamentState,
  TournamentViewerContext,
} from "@/lib/shared/types";
import { getDatabase, withConnection } from "@/lib/server/database";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { parseMatchFormat, type MatchFormat } from "@/lib/shared/match-format";
import { isSoloTournament, toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import type { TournamentListRow } from "./_internal";

// Internal types
export type { TournamentRow, RegistrationRow, MatchRow, TournamentListRow } from "./_internal";
export { mapCard, mapMatch, statusFromTeams } from "./_internal";

// State management
export { computeTournamentState, syncTournamentState, hasPendingStateTransition } from "./state";

// Registration (registerCurrentUserTeam is wrapped as public API function)
export { canUserRegister, resolveUserEntrantTeamId } from "./registration";

// Bracket generation
export { createBracketIfMissing } from "./bracket-generator";

// Aperçu du plateau avant le lancement (staff + cast)
export { loadTournamentPreview, isPreviewableState } from "./preview";

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

// Cache de la liste publique (voir ./list-cache)
export { invalidateTournamentLists, TOURNAMENT_LIST_TTL_MS } from "./list-cache";

// Cache de l'aperçu du plateau (voir ./preview-cache).
//
// `getTournamentPreview` n'est **pas** réexporté : il rend un contenu réservé
// aux permissions `tournaments` et `casting`, sans rien qui le rappelle dans sa
// signature. Le seul chemin vers l'aperçu passe donc par
// `getTournamentViewerContext`, qui exige ce droit — un appelant ne peut pas
// l'oublier.
export { invalidateTournamentPreview } from "./preview-cache";

// Instantané partagé (voir ./snapshot)
export {
  getTournamentSnapshot,
  getTournamentSnapshotFrame,
  invalidateTournamentSnapshot,
  SNAPSHOT_TTL_MS,
} from "./snapshot";
export type { TournamentSnapshotFrame } from "./snapshot";

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
import { mapCard } from "./_internal";
import { loadTournamentRow } from "./repository";
import { reportMatchScore } from "./scoring";
import { publishUpdatedEvent, publishScoreReportedEvent, publishScoreResolvedEvent, sendBotLogAsync } from "./notifications";
import { getTournamentSnapshot } from "./snapshot";
import { cachedTournamentList, invalidateTournamentLists } from "./list-cache";
import { getTournamentPreview } from "./preview-cache";

let pendingSync: Promise<void> | null = null;
let lastSyncAt = 0;
/**
 * Étranglement de la synchronisation d'états.
 *
 * Chaque passe ouvre une transaction et repasse sur **tous** les tournois non
 * terminés (plateau manquant, byes, reports expirés, finalisation) : à une
 * seconde d'intervalle, une poignée de visiteurs suffisait à la faire tourner
 * en continu. Quinze secondes suffisent largement — l'affichage, lui, ne
 * l'attend plus : le client fait basculer l'état à l'heure exacte tout seul
 * (`lib/shared/tournament-state.ts`), et la page d'un tournoi déclenche sa
 * propre bascule à la lecture (`./snapshot`).
 */
const SYNC_THROTTLE_MS = 15_000;

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

    const startVisibilityAt = new Date(payload.startVisibilityAt);
    const registrationOpenAt = new Date(payload.registrationOpenAt);
    const registrationCloseAt = new Date(payload.registrationCloseAt);
    const startAt = new Date(payload.startAt);

    if (
      Number.isNaN(startVisibilityAt.getTime()) ||
      Number.isNaN(registrationOpenAt.getTime()) ||
      Number.isNaN(registrationCloseAt.getTime()) ||
      Number.isNaN(startAt.getTime())
    ) {
      throw new Error("INVALID_DATES");
    }

    if (
      !(
        startVisibilityAt <= registrationOpenAt &&
        registrationOpenAt <= registrationCloseAt &&
        registrationCloseAt <= startAt
      )
    ) {
      throw new Error("INVALID_DATE_ORDER");
    }

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

    // Sans cela, le tournoi qu'on vient de créer resterait absent de la liste
    // publique et de l'accueil pendant toute la durée de vie du cache — au
    // moment précis où son auteur cherche une confirmation.
    invalidateTournamentLists();
    return tournamentId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Portée de la liste des tournois.
 *
 * Par défaut la liste ne montre que les tournois **déjà visibles**. `hiddenOnly`
 * prend exactement le complément : les tournois programmés que personne ne voit
 * encore. Les deux portées sont disjointes et se réunissent sur l'ensemble des
 * tournois — aucun ne peut se retrouver dans les deux, ni dans aucune.
 *
 * La portée `hiddenOnly` est réservée au staff `tournaments` : c'est la route
 * API qui garde la permission, jamais cette fonction.
 */
export type TournamentListScope = {
  hiddenOnly?: boolean;
};

/**
 * Paniers de tournois, par état.
 *
 * La liste publique (sans portée ni recherche) est **mutualisée** : c'est de
 * loin la lecture la plus sollicitée du site — accueil rendu dynamiquement,
 * page `/tournois`, bandeau « en direct » —, elle agrège tous les tournois et
 * toutes les inscriptions, et elle est la même pour tout le monde. Les
 * variantes — liste filtrée par une recherche, ou portée `hiddenOnly` réservée
 * au staff — passent directement en base : elles sont courtes et bien plus
 * rarement lues.
 */
export async function listTournamentBuckets(
  searchTerm: string | null,
  scope: TournamentListScope = {},
): Promise<TournamentBuckets> {
  // La synchronisation reste EN DEHORS du chargeur mis en cache : elle publie un
  // événement pour chaque état qui bascule, ce qui invalide justement la liste.
  // À l'intérieur, elle jetterait le résultat qu'elle vient de rendre correct,
  // et l'agrégat repartirait pour rien à chaque bascule.
  //
  // Son échec, lui, n'emporte pas la lecture : c'est un entretien d'arrière-plan
  // (une transaction sur tous les tournois en cours), pas une condition pour
  // servir une liste que le cache tient peut-être déjà prête. Un verrou ou une
  // panne passagère de MySQL viderait sinon `/tournois` alors qu'il n'y avait
  // rien à en faire.
  await syncVisibleTournaments().catch(() => undefined);

  // Seule la liste publique est mutualisée : celle des tournois pas encore
  // visibles est réservée au staff, elle est courte et bien plus rarement lue.
  const isSharedList = !scope.hiddenOnly && !searchTerm?.trim();
  if (!isSharedList) return loadTournamentBuckets(searchTerm, scope);

  return cachedTournamentList("public", () => loadTournamentBuckets(searchTerm, scope));
}

async function loadTournamentBuckets(
  searchTerm: string | null,
  scope: TournamentListScope,
): Promise<TournamentBuckets> {
  const db = await getDatabase();
  const now = new Date();

  const where: string[] = [scope.hiddenOnly ? `t.start_visibility_at > ?` : `t.start_visibility_at <= ?`];
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
      t.live_url,
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
      t.match_format_value,
      t.live_url
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

/**
 * Contexte propre au lecteur : ce qu'il a le droit de faire ici.
 *
 * Séparé de l'instantané partagé parce qu'il ne bouge presque jamais (il change
 * à l'inscription, pas à chaque score) et qu'il est le seul morceau du détail
 * qu'on ne puisse pas mutualiser entre spectateurs.
 */
export async function getTournamentViewerContext(
  snapshot: TournamentSnapshot,
  userId: number,
  isAdmin = false,
  /**
   * Droit de voir l'aperçu du plateau avant le lancement : permission
   * `tournaments` **ou** `casting`. Le staff l'a par construction, le cast l'a
   * sans aucun droit d'écriture.
   */
  canPreview = isAdmin,
  /**
   * Droit d'écrire l'état de diffusion des matchs : permission `live`. Distinct
   * de `canPreview`, qui ne donne que la lecture de l'aperçu — un caster lit le
   * tirage **et** ouvre l'antenne, sans pour autant arbitrer.
   */
  canManageLive = isAdmin,
): Promise<TournamentViewerContext> {
  const isSolo = isSoloTournament(snapshot.card.participantType);

  // Engagé du viewer : son équipe active, ou son entrée solo en individuel.
  //
  // La connexion n'est prise que dans le second cas — le seul où
  // `resolveUserEntrantTeamId` s'en serve : en tournoi par équipes,
  // `getUserActiveTeam` ouvre sa propre requête, et réserver une place du pool
  // (25) pour ne rien en faire doublerait la pression à chaque connexion SSE.
  const myTeamId = isSolo
    ? await withConnection((connection) =>
        resolveUserEntrantTeamId(
          connection,
          { participant_type: snapshot.card.participantType },
          userId,
        ),
      )
    : (await getUserActiveTeam(userId))?.teamId ?? null;

  const alreadyRegistered =
    myTeamId !== null && snapshot.registrations.some((row) => row.teamId === myTeamId);

  // L'aperçu vit dans le contexte du lecteur, et non dans l'instantané : celui-ci
  // part tel quel à tous les abonnés du flux, alors que l'aperçu est réservé au
  // staff et au cast. Son contenu, lui, est le même pour tous ceux qui y ont
  // droit : il est donc calculé une fois par tournoi (`./preview-cache`), pas
  // une fois par lecteur.
  const preview = canPreview ? await getTournamentPreview(snapshot.card.id) : null;

  return {
    preview,
    canRegister:
      snapshot.card.state === "REGISTRATION" &&
      !alreadyRegistered &&
      // En individuel, un joueur sans entrée solo peut s'inscrire : elle sera
      // créée à ce moment-là.
      (isSolo || myTeamId !== null),
    myTeamId,
    canCreateReportsForTeamIds: myTeamId ? [myTeamId] : [],
    isAdmin,
    canManageLive,
  };
}

/**
 * Détail complet du tournoi pour un lecteur donné : l'instantané partagé
 * (mutualisé entre tous les spectateurs, voir `./snapshot`) complété de son
 * contexte personnel.
 */
export async function getTournamentDetail(
  tournamentId: number,
  userId: number,
  isAdmin = false,
  /**
   * Droit de voir l'aperçu du plateau avant le lancement : permission
   * `tournaments` **ou** `casting`. Le staff l'a par construction, le cast l'a
   * sans aucun droit d'écriture.
   */
  canPreview = isAdmin,
  /**
   * Droit d'écrire l'état de diffusion des matchs : permission `live`. Distinct
   * de `canPreview`, qui ne donne que la lecture de l'aperçu.
   */
  canManageLive = isAdmin,
): Promise<TournamentDetail | null> {
  const snapshot = await getTournamentSnapshot(tournamentId);
  if (!snapshot) return null;

  const viewer = await getTournamentViewerContext(
    snapshot,
    userId,
    isAdmin,
    canPreview,
    canManageLive,
  );
  return { ...snapshot, ...viewer };
}

/**
 * Rafraîchit la liste publique si — et seulement si — l'écriture qui vient
 * d'aboutir a changé l'état du tournoi.
 *
 * Les événements de score n'y touchent plus (voir `./notifications`), mais un
 * score peut clore un tournoi, et une clôture le déplace dans la liste. Plutôt
 * que de faire remonter un « ça a fini » à travers les cinq orchestrations qui
 * peuvent clore (élimination, survie, suisse, endurance, phases), on relit
 * l'état : une lecture indexée, sur un chemin d'écriture rare.
 *
 * **Ne lève jamais.** Elle s'exécute après le commit : une erreur ici ferait
 * répondre 500 pour un score pourtant enregistré, l'équipe le ressaisirait et
 * se heurterait à `MATCH_ALREADY_COMPLETED`. Au pire, la liste garde son entrée
 * quinze secondes de plus.
 *
 * @param before État lu **avant** la transaction.
 */
async function invalidateListsIfStateChanged(
  tournamentId: number,
  before: TournamentState | null,
): Promise<void> {
  try {
    const after = await readTournamentState(tournamentId);
    if (after !== before) invalidateTournamentLists();
  } catch {
    // Le cache expirera de lui-même : rien ne justifie de perdre l'écriture.
  }
}

/** État courant d'un tournoi, ou `null` s'il n'existe pas / plus. */
async function readTournamentState(tournamentId: number): Promise<TournamentState | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { state: TournamentState })[]>(
    `SELECT state FROM bg_tournaments WHERE id = ? LIMIT 1`,
    [tournamentId],
  );
  return rows[0]?.state ?? null;
}

export async function reportMatchScorePublic(
  tournamentId: number,
  matchId: number,
  userId: number,
  myScoreRaw: number,
  opponentScoreRaw: number,
): Promise<void> {
  const stateBefore = await readTournamentState(tournamentId);
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
    await invalidateListsIfStateChanged(tournamentId, stateBefore);
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
      // L'état d'avant n'a pas pu être lu (l'id du tournoi ne se découvre qu'en
      // cours de transaction) : on rafraîchit donc la liste sans condition. Un
      // arbitrage reste rare, contrairement au report de score.
      invalidateTournamentLists();
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
    // Même raison que pour la sauvegarde de scores : l'état d'avant n'a pas pu
    // être lu, l'id du tournoi ne se découvrant qu'en cours de transaction. Un
    // arbitrage reste rare, contrairement au report de score.
    invalidateTournamentLists();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
