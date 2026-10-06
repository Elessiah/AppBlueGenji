import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  FinishedTournamentTotals,
  TournamentBuckets,
  TournamentCard,
  TournamentDetail,
  TournamentFormat,
  TournamentGame,
  TournamentSnapshot,
  TournamentState,
  TournamentViewerContext,
} from "@/lib/shared/types";
import { getDatabase, withConnection, type SqlParams } from "@/lib/server/database";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { parseMatchFormat, type MatchFormat } from "@/lib/shared/match-format";
import { isSoloTournament, toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import {
  parseRegistrationFilters,
  type RegistrationFilters,
} from "@/lib/shared/registration-filters";
import { checkEntrantEligibility } from "./registration-eligibility";
import type { PhaseConfig } from "@/lib/shared/tournament-phases";
import { hasTeamManagementRole } from "@/lib/shared/team-roles";
import { canDeclareTeamReady } from "@/lib/shared/match-launch";
import { canViewTournament } from "@/lib/shared/tournament-visibility";
import { computeTournamentState as sharedComputeTournamentState } from "@/lib/shared/tournament-state";
import { parseTournamentDates } from "./validation";
import type { TournamentListRow } from "./_internal";

// Internal types
export type { TournamentRow, RegistrationRow, MatchRow, TournamentListRow } from "./_internal";
export { mapCard, mapMatch, statusFromTeams } from "./_internal";

// State management
export { computeTournamentState, syncTournamentState, hasPendingStateTransition } from "./state";

// Registration (registerCurrentUserTeam is wrapped as public API function)
export { canUserRegister, resolveUserEntrantTeamId } from "./registration";
export type { UserEntrant } from "./registration";

// Bracket generation
export { createBracketIfMissing } from "./bracket-generator";

// Aperçu du plateau avant le lancement (staff + cast)
export { loadTournamentPreview, isPreviewableState } from "./preview";

// Scoring
export { reportMatchScore, finalizeMatch } from "./scoring";

// Admin (adminResolveMatch is wrapped as public API function)
export { adminSaveMatchScores, checkDownstreamMatchesHaveNoScores } from "./admin";

// Suppression définitive (administrateurs)
export { deleteTournament } from "./deletion";
export type { DeletedTournament } from "./deletion";

// Notifications
export {
  publishUpdatedEvent,
  publishScoreReportedEvent,
  publishScoreResolvedEvent,
} from "./notifications";

// Journal Discord (voir ./bot-logs)
export { queueBotLog, flushBotLogs, discardBotLogs } from "./bot-logs";

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
//
// Ni `getTournamentSnapshot` ni `getTournamentSnapshotFrame` ne sont réexportés,
// **délibérément** : aucun des deux ne consulte `start_visibility_at`, et la
// trame contient l'instantané entier. Une route qui les appellerait servirait
// un tournoi non publié à qui devine son identifiant. Le seul chemin offert au
// dehors est `getVisibleTournamentSnapshot` (plus bas), qui exige les droits du
// lecteur — même précaution que pour `getTournamentPreview` ci-dessus.
//
// La salle de diffusion (`lib/server/tournament-broadcast.ts`) est la seule à
// avoir besoin de la trame, et l'importe directement de `./snapshot` : elle ne
// sert que des abonnés que la route du flux a déjà laissés passer.
export { invalidateTournamentSnapshot, SNAPSHOT_TTL_MS } from "./snapshot";
export type { TournamentSnapshotFrame } from "./snapshot";

// Byes
export { tryAutoResolveByes } from "./byes";

// Finalization
export { finalizeTournamentIfDone, resolveExpiredScoreReports } from "./finalization";

// Édition
export { loadEditableTournament, updateTournament } from "./edit";
export type { EditableTournamentValues } from "./edit";

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
export { forfeitEnduranceTeam } from "./bg-survie/forfeit";
export { loadEnduranceMeta } from "./bg-survie/meta";
export { startEndurancePlayoffs } from "./bg-survie/playoffs";
export { initializeEnduranceTournament, generateEnduranceRound } from "./bg-survie/qualification";
export { reconcileEndurance } from "./bg-survie/reconcile";

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
  registerTeamsByIds as registerTeamsByIdsInternal,
  resolveUserEntrant,
  resolveUserEntrantTeamId,
  type UserEntrant,
} from "./registration";
import { resolveExpiredScoreReports, finalizeTournamentIfDone } from "./finalization";
import { tryAutoResolveByes } from "./byes";
import { mapCard } from "./_internal";
import { loadCardSummaries, type CardSummary } from "./list-summary";
import { getTournamentListRow, loadTournamentRow } from "./repository";
import { reportMatchScore } from "./scoring";
import type { MatchMapInput } from "@/lib/shared/match-maps";
import { isTransactionAborted } from "@/lib/server/mysql-errors";
import type { AdminMapEntry } from "./admin";
import {
  publishMatchUpdatedEvent,
  publishUpdatedEvent,
  publishScoreReportedEvent,
  publishScoreResolvedEvent,
} from "./notifications";
import { discardBotLogs, flushBotLogs, queueBotLog } from "./bot-logs";
import { getTournamentSnapshot } from "./snapshot";
import { cachedTournamentList, invalidateTournamentLists } from "./list-cache";
import { getTournamentPreview } from "./preview-cache";
import { dispatchDueMatchReminders } from "./match-reminders";
import { dispatchMatchStartNotices, notifyScoreToConfirm } from "./player-pushes";
import { purgeExpiredConnectionLogs } from "@/lib/server/connection-logs";
import { maintainSiteVisitRetention } from "@/lib/server/site-visits-service";
import { findTournamentsNeedingSync } from "./sync-scope";
import { FINISHED_TOURNAMENTS_LIST_LIMIT } from "@/lib/shared/constants";
import { loadViewerCastBlock } from "./match-launch";

let pendingSync: Promise<void> | null = null;
let lastSyncAt = 0;
/**
 * Étranglement de la synchronisation d'états.
 *
 * Chaque passe entretient les tournois qui ont quelque chose à faire (plateau
 * manquant, byes, reports expirés, finalisation) : à une seconde d'intervalle,
 * une poignée de visiteurs suffisait à la faire tourner en continu. Quinze
 * secondes suffisent largement — l'affichage, lui, ne l'attend plus : le client
 * fait basculer l'état à l'heure exacte tout seul
 * (`lib/shared/tournament-state.ts`), et la page d'un tournoi déclenche sa
 * propre bascule à la lecture (`./snapshot`).
 */
const SYNC_THROTTLE_MS = 15_000;

/**
 * Entretien de fond des tournois.
 *
 * Deux principes, tirés d'une passe qui prenait des minutes sur une base de
 * démonstration et tenait derrière elle toute écriture sur `bg_tournaments` :
 *
 * 1. **On ne visite que ce qui a quelque chose à faire.** `findTournamentsNeedingSync`
 *    (`./sync-scope`) réduit la passe aux tournois dont un jalon de calendrier
 *    est franchi ou dont une tâche d'entretien est réellement due. Un plateau
 *    en cours, sans bye ni report expiré, ne coûte plus rien.
 * 2. **Une transaction par tournoi.** L'ancienne passe n'en ouvrait qu'une, pour
 *    tous : sa durée était la somme des entretiens, et un verrou de plusieurs
 *    minutes en découlait. Les tournois sont indépendants — le découpage ne
 *    perd aucune garantie, et il borne le verrou à un seul d'entre eux.
 *
 * L'échec d'un tournoi n'emporte donc pas les suivants : sa transaction est
 * défaite, ses lignes de journal jetées, et la passe continue. L'entretien est
 * de toute façon idempotent, le prochain balayage le retrouvera.
 *
 * Exportée pour les tests seulement : `listTournamentBuckets` la lance sans
 * l'attendre, si bien qu'on ne pourrait pas observer la fin d'une passe par elle.
 */
export async function syncVisibleTournaments(): Promise<void> {
  if (pendingSync) return pendingSync;
  if (Date.now() - lastSyncAt < SYNC_THROTTLE_MS) return;

  pendingSync = (async () => {
    const db = await getDatabase();
    const connection = await db.getConnection();
    const changedIds: number[] = [];
    const launchIds: number[] = [];

    try {
      // Hors transaction : c'est une lecture de repérage, et l'ouvrir dans une
      // transaction rendrait à la première la durée qu'on vient de lui retirer.
      const candidates = await findTournamentsNeedingSync(connection);

      for (const tournamentId of candidates) {
        try {
          await connection.beginTransaction();
          const { stateChanged, contentChanged, launchesChanged } = await syncTournamentState(
            connection,
            tournamentId,
          );
          await connection.commit();
          flushBotLogs(connection);
          // `contentChanged` autant que `stateChanged` : un plateau créé ou une
          // manche tranchée par le délai ne déplace pas le tournoi d'un état,
          // mais c'est bien ce que les spectateurs attendent de voir. La
          // publication reste **après le commit** — c'est tout l'objet de ce
          // retour plutôt qu'un événement publié depuis le fond du moteur.
          if (stateChanged || contentChanged) changedIds.push(tournamentId);
          // Un lancement ne concerne que le plateau de ce tournoi : ni la liste,
          // ni la vitrine, ni le classement n'ont à être vidés pour lui.
          else if (launchesChanged) launchIds.push(tournamentId);
        } catch {
          await connection.rollback().catch(() => undefined);
        } finally {
          discardBotLogs(connection);
        }
      }
    } finally {
      connection.release();
    }

    for (const id of changedIds) {
      publishUpdatedEvent(id);
    }
    for (const id of launchIds) {
      publishMatchUpdatedEvent(id, { landingLive: true });
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
    game?: "OW" | "MR";
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
    /**
     * BlueGenji Survie : format de l'arbre final (`null` = celui du tournoi).
     * Il existe parce que la phase qualificative peut, elle, se jouer avec des
     * égalités — ce qu'une élimination directe ne sait pas trancher.
     */
    endurancePlayoffFormat?: MatchFormat | null;
    /** BlueGenji Survie : capital d'endurance et barème (null = défauts). */
    endurancePoints?: number | null;
    enduranceWinDelta?: number | null;
    enduranceLossDelta?: number | null;
    endurancePlayoffSize?: number | null;
    /** Plafond de manches qualificatives (null = phase à durée libre). */
    enduranceMaxRounds?: number | null;
    /**
     * Phases du format MULTI, brutes (non normalisées : `position`, `name`…
     * peuvent être absents) — voir `normalizePhaseConfigs` juste en dessous,
     * qui les complète avant validation et insertion.
     */
    phases?: readonly Partial<PhaseConfig>[];
    /**
     * Conditions d'inscription (`lib/shared/registration-filters.ts`). Absentes
     * = les défauts du module — « au moins un Discord vérifié », aucune exigence
     * Blizzard, et cinq joueurs.
     */
    registrationFilters?: RegistrationFilters | null;
    /** Matchs planifiés par l'arbitrage ; absent = option éteinte. */
    refereeScheduling?: boolean | null;
  },
): Promise<number> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Une seule analyse des quatre jalons : `parseTournamentDates` contrôle
    // l'ordre et rend les `Date` qu'on insère juste après.
    const dates = parseTournamentDates({
      startVisibilityAt: payload.startVisibilityAt,
      registrationOpenAt: payload.registrationOpenAt,
      registrationCloseAt: payload.registrationCloseAt,
      startAt: payload.startAt,
    });
    if (dates.error) throw new Error(dates.error);

    const { startVisibilityAt, registrationOpenAt, registrationCloseAt, startAt } = dates.value;

    const { computeTournamentState } = await import("./state");

    const temporaryState: TournamentState = computeTournamentState({
      state: "UPCOMING",
      finished_at: null,
      registration_open_at: registrationOpenAt,
      registration_close_at: registrationCloseAt,
      start_at: startAt,
    });

    // La neutralisation hors `SINGLE` vit dans `validateTournamentInput`, seul
    // endroit où création et édition la partagent (`./validation`).
    const hasThirdPlaceMatch = Boolean(payload.hasThirdPlaceMatch);
    const game = payload.game ?? "OW";
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
      payload.matchFormat?.maxMaps ?? null,
      payload.matchFormat?.drawsAllowed ?? null,
    );

    // Format de l'arbre final en BlueGenji Survie. `null` = celui du tournoi,
    // et jamais d'égalité : la phase qualificative peut clore un match sans
    // vainqueur, l'arbre a besoin de savoir qui joue le tour suivant.
    const playoffFormat =
      payload.format === "BG_SURVIE"
        ? parseMatchFormat(
            payload.endurancePlayoffFormat?.type ?? null,
            payload.endurancePlayoffFormat?.value ?? null,
          )
        : null;

    // Conditions d'inscription : revalidées ici comme le format de match, pour
    // que le service reste sûr appelé hors de la route HTTP (seed, scripts).
    const registrationFilters = parseRegistrationFilters(
      payload.registrationFilters?.discordRequirement,
      payload.registrationFilters?.minPlayers,
      payload.registrationFilters?.blizzardRequirement,
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
        endurance_max_rounds,
        match_format_type,
        match_format_value,
        match_format_max_maps,
        match_format_draws,
        endurance_playoff_format_type,
        endurance_playoff_format_value,
        registration_discord_requirement,
        registration_blizzard_requirement,
        registration_min_players,
        referee_scheduling
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        payload.enduranceMaxRounds ?? null,
        // Les deux colonnes vont par paire : une seule renseignée décrirait un
        // format incomplet, que `parseMatchFormat` relirait comme « libre ».
        matchFormat?.type ?? null,
        matchFormat?.value ?? null,
        matchFormat?.maxMaps ?? null,
        matchFormat?.drawsAllowed ? 1 : 0,
        playoffFormat?.type ?? null,
        playoffFormat?.value ?? null,
        registrationFilters.discordRequirement,
        registrationFilters.blizzardRequirement,
        registrationFilters.minPlayers,
        payload.refereeScheduling === true ? 1 : 0,
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

    queueBotLog(connection, { kind: "tournament_created", tournamentId });

    await connection.commit();
    flushBotLogs(connection);

    // Sans cela, le tournoi qu'on vient de créer resterait absent de la liste
    // publique et de l'accueil pendant toute la durée de vie du cache — au
    // moment précis où son auteur cherche une confirmation.
    invalidateTournamentLists();
    return tournamentId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
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
  /**
   * Liste publique avec **tous** les tournois terminés. Sans ce drapeau, la
   * liste publique n'en porte que les `FINISHED_TOURNAMENTS_LIST_LIMIT` plus
   * récents, et dit combien il y en a en tout (`finishedTotals`). Sans effet
   * sur une recherche ou sur `hiddenOnly`, déjà complètes.
   */
  allFinished?: boolean;
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
  // Elle n'est pas non plus **attendue** : c'est un entretien d'arrière-plan
  // (une transaction par tournoi à entretenir), pas une condition pour servir
  // la liste. L'attendre faisait payer toutes les 15 s la passe entière à la
  // requête qui tombait dessus — rendu de l'accueil, `GET /api/tournaments` —
  // et à toutes celles qui arrivaient pendant (`pendingSync`), alors que
  // l'affichage n'en dépend plus : le client fait basculer les états seul
  // (`useScheduledBuckets`), et ce que la passe écrit est publié en fin de
  // passe (`publishUpdatedEvent`), ce qui vide la liste mise en cache — une
  // lecture partie pendant la passe n'y range pas son résultat, le cache
  // comptant les invalidations. Son échec n'emporte rien non plus : un verrou
  // ou une panne passagère de MySQL viderait sinon `/tournois` alors qu'il n'y
  // avait rien à en faire.
  void syncVisibleTournaments().catch(() => undefined);

  // Les rappels de match n'ont pas d'ordonnanceur : c'est le trafic qui les
  // entraîne, comme la bascule d'état juste au-dessus. Étranglé à une minute et
  // sans attente ici — un bot lent ou injoignable ne doit pas retarder la
  // liste, et le prochain passage rattrapera ce qui reste dû.
  void dispatchDueMatchReminders().catch(() => undefined);
  // Même raison pour les départs de match : un lancement ouvert par l'horloge
  // n'a pas toujours d'écriture derrière lui pour déclencher son annonce.
  void dispatchMatchStartNotices().catch(() => undefined);
  // Le journal des connexions se purge aussi sur ce trafic, pas seulement aux
  // connexions : une période sans connexion (sessions de 30 jours) garderait
  // sinon des lignes au-delà de la durée légale annoncée. Étranglée à l'heure.
  void purgeExpiredConnectionLogs().catch(() => undefined);
  // Même raison pour la mesure d'audience : son entretien suit aussi les
  // signalements de visite, qu'un visiteur opposé n'envoie pas. Sans cette
  // seconde entrée, un site où tout le monde s'oppose ne tiendrait plus les
  // durées annoncées. Étranglé à l'heure, jamais levé.
  maintainSiteVisitRetention();

  // Seule la liste publique est mutualisée : celle des tournois pas encore
  // visibles est réservée au staff, elle est courte et bien plus rarement lue.
  const isSharedList = !scope.hiddenOnly && !searchTerm?.trim();
  if (!isSharedList) return loadTournamentBuckets(searchTerm, scope, null);

  // Deux listes mutualisées : la courante, lue par l'accueil et chaque
  // ouverture de `/tournois`, ne porte que les terminés les plus récents ;
  // l'archive entière n'est calculée que pour qui la demande. Le préfixe commun
  // les fait vider ensemble (`invalidateTournamentLists`).
  if (scope.allFinished) {
    return cachedTournamentList("public:all-finished", () =>
      loadTournamentBuckets(searchTerm, scope, null),
    );
  }
  return cachedTournamentList("public", () =>
    loadTournamentBuckets(searchTerm, scope, FINISHED_TOURNAMENTS_LIST_LIMIT),
  );
}

/**
 * Nombre de tournois terminés visibles, en tout et par jeu — ce que la liste
 * tronquée ne porte plus, mais que `/tournois` affiche (sommaire, pastilles de
 * jeu, « Voir plus »).
 */
async function loadFinishedTotals(
  db: Awaited<ReturnType<typeof getDatabase>>,
  now: Date,
): Promise<FinishedTournamentTotals> {
  const [rows] = await db.execute<(RowDataPacket & { game: TournamentGame; total: number | string })[]>(
    `SELECT t.game, COUNT(*) AS total
     FROM bg_tournaments t
     WHERE t.state = 'FINISHED' AND t.start_visibility_at <= ?
     GROUP BY t.game`,
    [now],
  );
  const totals: FinishedTournamentTotals = { all: 0, byGame: { OW: 0, MR: 0 } };
  for (const row of rows) {
    const count = Number(row.total) || 0;
    totals.all += count;
    if (row.game === "OW" || row.game === "MR") totals.byGame[row.game] += count;
  }
  return totals;
}

/**
 * @param finishedLimit Nombre de tournois terminés à porter (les plus
 * récents, dans l'ordre de la liste), ou `null` pour les porter tous. Borné,
 * le résultat dit aussi combien il y en a en tout (`finishedTotals`).
 */
async function loadTournamentBuckets(
  searchTerm: string | null,
  scope: TournamentListScope,
  finishedLimit: number | null,
): Promise<TournamentBuckets> {
  const db = await getDatabase();
  const now = new Date();
  const { where, params } = tournamentListFilter(searchTerm, scope, finishedLimit, now);

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
      t.match_format_max_maps,
      t.match_format_draws,
      t.endurance_playoff_format_type,
      t.endurance_playoff_format_value,
      t.registration_discord_requirement,
      t.registration_blizzard_requirement,
      t.registration_min_players,
      t.referee_scheduling,
      t.live_url,
      t.image_url,
      t.image_fit,
      t.image_focus_x,
      t.image_focus_y,
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
      t.match_format_max_maps,
      t.match_format_draws,
      t.endurance_playoff_format_type,
      t.endurance_playoff_format_value,
      t.registration_discord_requirement,
      t.registration_blizzard_requirement,
      t.registration_min_players,
      t.referee_scheduling,
      t.live_url,
      t.image_url,
      t.image_fit,
      t.image_focus_x,
      t.image_focus_y
     ORDER BY t.start_at DESC, t.id DESC`,
    params,
  );

  const buckets: TournamentBuckets = {
    upcoming: [],
    registration: [],
    running: [],
    finished: [],
  };

  // Sans décompte, rien ne dirait que des terminés ont été laissés de côté : une
  // liste tronquée passerait pour complète, sans « Voir plus », et resterait en
  // cache ainsi pour tout le monde. On sert alors la liste entière — plus
  // lourde, jamais fausse — plutôt que de vider `/tournois` pour un compteur.
  let finishedTotals: FinishedTournamentTotals | null = null;
  if (finishedLimit !== null) {
    finishedTotals = await loadFinishedTotals(db, now).catch((error: unknown) => {
      console.error("[tournaments] décompte des tournois terminés indisponible :", error);
      return null;
    });
    if (finishedTotals === null) return loadTournamentBuckets(searchTerm, scope, null);
  }

  const cards = rows.map(mapCard);
  // Décoratifs : une panne de ces lectures ne doit pas vider `/tournois` et
  // l'accueil, qui s'en passent très bien (les cartes retombent sur leurs
  // `null`).
  const summaries = await loadCardSummaries(db, cards).catch((error: unknown) => {
    console.error("[tournaments] résumé des cartes indisponible :", error);
    return new Map<number, Partial<CardSummary>>();
  });

  for (const [index, row] of rows.entries()) {
    const bucket = BUCKET_BY_STATE.get(row.state);
    if (bucket) buckets[bucket].push({ ...cards[index], ...summaries.get(cards[index].id) });
  }

  // Rien n'a été laissé de côté : la liste est complète, et le dit par
  // l'absence du champ — une page n'a pas à aller chercher une archive vide.
  if (finishedTotals && finishedTotals.all > buckets.finished.length) {
    buckets.finishedTotals = finishedTotals;
  }

  return buckets;
}

/** Panier de la liste où range chaque état de tournoi. */
const BUCKET_BY_STATE: ReadonlyMap<string, "upcoming" | "registration" | "running" | "finished"> =
  new Map([
    ["UPCOMING", "upcoming"],
    ["REGISTRATION", "registration"],
    ["RUNNING", "running"],
    ["FINISHED", "finished"],
  ]);

/** Clause `WHERE` de la liste : visibilité, recherche et troncature des terminés. */
function tournamentListFilter(
  searchTerm: string | null,
  scope: TournamentListScope,
  finishedLimit: number | null,
  now: Date,
): { where: string[]; params: SqlParams } {
  const where: string[] = [scope.hiddenOnly ? `t.start_visibility_at > ?` : `t.start_visibility_at <= ?`];
  const params: SqlParams = [now];

  if (searchTerm?.trim()) {
    where.push(`LOWER(t.name) LIKE ?`);
    params.push(`%${searchTerm.trim().toLowerCase()}%`);
  }

  // La table dérivée n'est pas décorative : ni MariaDB ni MySQL n'acceptent un
  // `LIMIT` directement dans un `IN (SELECT …)`. Même ordre que la liste, pour
  // que les terminés portés soient bien les premiers qu'elle affiche.
  // `finishedLimit` est un entier du module, jamais une entrée.
  if (finishedLimit !== null) {
    where.push(
      `(t.state <> 'FINISHED' OR t.id IN (
         SELECT recent.id FROM (
           SELECT f.id FROM bg_tournaments f
           WHERE f.state = 'FINISHED' AND f.start_visibility_at <= ?
           ORDER BY f.start_at DESC, f.id DESC
           LIMIT ${Math.max(0, Math.floor(finishedLimit))}
         ) recent))`,
    );
    params.push(now);
  }
  return { where, params };
}

export async function registerCurrentUserTeam(tournamentId: number, userId: number): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await registerTeamInternal(connection, tournamentId, userId);
    await connection.commit();
    flushBotLogs(connection);

    publishUpdatedEvent(tournamentId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}

/**
 * Engagé du joueur dans un tournoi, vu de l'extérieur du module (routes API) :
 * son équipe active, ou son entrée solo si le tournoi est individuel — avec sa
 * qualité pour agir au nom de cet engagé. `teamId: null` signifie « rien à
 * engager » ; un tournoi inconnu lève, pour que l'appelant puisse répondre 404
 * plutôt que de parler d'équipe manquante.
 *
 * @throws TOURNAMENT_NOT_FOUND
 */
export async function getUserEntrant(
  tournamentId: number,
  userId: number,
): Promise<UserEntrant> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    const tournament = await loadTournamentRow(connection, tournamentId);
    if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
    return await resolveUserEntrant(connection, tournament, userId);
  } finally {
    connection.release();
  }
}

/**
 * Inscrit un **lot** d'équipes fantômes au nom du staff. L'appelant (route API)
 * vérifie la permission `tournaments` ; le caractère fantôme de chaque équipe
 * est relu dans la transaction, au plus près de l'écriture.
 *
 * **Tout ou rien** : une seule transaction, un seul événement de flux. Un lot est
 * une intention unique, et un résultat partiel obligerait le staff à recouper sa
 * sélection contre la liste des inscrites pour savoir ce qui est passé. Le
 * plafond d'effectif est relu à chaque insertion, sur la connexion de la
 * transaction : le compte grandit avec le lot, et la place manquante arrête
 * l'ensemble par `TOURNAMENT_FULL`.
 *
 * Un seul `publishUpdatedEvent` après le commit : le panneau d'inscriptions et
 * l'aperçu du plateau se refont une fois, sur l'état final, plutôt que N fois
 * sur des états intermédiaires qui n'ont jamais existé hors de la transaction.
 */
export async function registerGhostTeams(tournamentId: number, teamIds: number[]): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    await registerTeamsByIdsInternal(connection, tournamentId, teamIds);
    await connection.commit();
    flushBotLogs(connection);

    publishUpdatedEvent(tournamentId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}

/**
 * Droits du lecteur sur **ce** tournoi, tels que la route les a résolus depuis
 * ses permissions.
 *
 * Objet nommé et non une suite de booléens positionnels : ils sont quatre, tous
 * du même type, et deux d'entre eux ouvrent des pouvoirs très différents. Une
 * inversion d'arguments accorderait silencieusement la suppression d'un tournoi
 * à un caster, sans qu'aucun type ne bronche.
 *
 * Tout champ omis vaut `false` : un appelant qui ne se pose pas la question
 * n'accorde rien.
 */
export type TournamentViewerRights = {
  /** Permission `tournaments` : création et arbitrage. */
  canManage?: boolean;
  /**
   * Droit de voir l'aperçu du plateau avant le lancement : permission
   * `tournaments` **ou** `casting`. Le staff l'a par construction, le cast l'a
   * sans aucun droit d'écriture.
   */
  canPreview?: boolean;
  /**
   * Droit d'écrire l'état de diffusion des matchs : permission `live`. Distinct
   * de `canPreview`, qui ne donne que la lecture de l'aperçu — un caster lit le
   * tirage **et** ouvre l'antenne, sans pour autant arbitrer.
   */
  canManageLive?: boolean;
  /**
   * Droit de supprimer définitivement le tournoi : administrateur strict, et
   * non simple porteur de la permission `tournaments` — un arbitre gère un
   * tournoi, il ne l'efface pas (`docs/features/TOURNAMENT_DELETION.md`).
   */
  canDelete?: boolean;
};

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
  rights: TournamentViewerRights = {},
): Promise<TournamentViewerContext> {
  const {
    canManage = false,
    // L'arbitrage donne l'aperçu et l'antenne par construction : qui gère le
    // tournoi n'a pas à porter un rôle de plus pour le lire ou le caster.
    canPreview = canManage,
    canManageLive = canManage,
    canDelete = false,
  } = rights;
  const isSolo = isSoloTournament(snapshot.card.participantType);

  // Engagé du viewer : son équipe active, ou son entrée solo en individuel.
  //
  // La connexion n'est prise que dans le second cas — le seul où
  // `resolveUserEntrantTeamId` s'en serve : en tournoi par équipes,
  // `getUserActiveTeam` ouvre sa propre requête, et réserver une place du pool
  // (25) pour ne rien en faire doublerait la pression à chaque connexion SSE.
  const activeTeam = isSolo ? null : await getUserActiveTeam(userId);
  const myTeamId = isSolo
    ? await withConnection((connection) =>
        resolveUserEntrantTeamId(
          connection,
          { participant_type: snapshot.card.participantType },
          userId,
        ),
      )
    : activeTeam?.teamId ?? null;

  // Qualité pour **engager** son équipe : `OWNER` ou `MANAGER`
  // (`lib/shared/team-roles.ts`). En individuel, le joueur n'engage que lui-même.
  //
  // Ce fait tient à la personne et non au plateau : il voyage donc dans le
  // contexte du lecteur, comme `canManageLive` ou `canDelete`, et le client le
  // rejoue tel quel à chaque instantané plutôt que de le recalculer — un
  // instantané ne connaît pas les rosters.
  const canRegisterEntrant = isSolo || hasTeamManagementRole(activeTeam?.roles);

  const alreadyRegistered =
    myTeamId !== null && snapshot.registrations.some((row) => row.teamId === myTeamId);

  // Conditions d'inscription du tournoi (`lib/shared/registration-filters.ts`).
  //
  // **Posées ici et pas seulement à l'écriture**, parce qu'un bouton qui mène à
  // un 409 est un bouton qui ment : c'est la règle de la maison, la même qui
  // ferme « Éditer le score » sur une manche verrouillée. Le serveur reste le
  // juge — le roster peut changer entre le rendu et le clic.
  //
  // La lecture n'a lieu **que quand elle peut changer la réponse** : inscriptions
  // ouvertes, engagé identifié, pas déjà inscrit, qualité pour engager. Ailleurs
  // le bouton est de toute façon fermé, et une requête de roster par connexion
  // SSE n'aurait servi à personne.
  const mayStillRegister =
    snapshot.card.state === "REGISTRATION" &&
    !alreadyRegistered &&
    canRegisterEntrant &&
    (isSolo || myTeamId !== null);

  const entrant = { teamId: myTeamId, soloUserId: isSolo ? userId : null };
  const registrationBlock = mayStillRegister
    ? await withConnection((connection) =>
        checkEntrantEligibility(connection, snapshot.card.registrationFilters, entrant),
      )
    : null;

  // L'aperçu vit dans le contexte du lecteur, et non dans l'instantané : celui-ci
  // part tel quel à tous les abonnés du flux, alors que l'aperçu est réservé au
  // staff et au cast. Son contenu, lui, est le même pour tous ceux qui y ont
  // droit : il est donc calculé une fois par tournoi (`./preview-cache`), pas
  // une fois par lecteur.
  const preview = canPreview ? await getTournamentPreview(snapshot.card.id) : null;

  // Inscription comme caster : la permission ne suffit pas, il faut aussi une
  // identité vérifiée (`castBlockReason`).
  const castBlock = await loadViewerCastBlock(userId, canManageLive);

  return {
    preview,
    // En individuel, un joueur sans entrée solo peut s'inscrire : elle sera
    // créée à ce moment-là — `mayStillRegister` en tient compte.
    canRegister: mayStillRegister && registrationBlock === null,
    canRegisterEntrant,
    registrationBlock,
    myTeamId,
    // Reporter un score revient à ceux qui mènent le match — capitaine, manager,
    // propriétaire (`reportMatchScore` refuse `NOT_TEAM_MATCH_LEADER`) : un
    // bouton qui mène à un 403 est un bouton qui ment.
    canCreateReportsForTeamIds:
      myTeamId && (isSolo || canDeclareTeamReady(activeTeam?.roles)) ? [myTeamId] : [],
    isAdmin: canManage,
    canDelete,
    canManageLive,
    viewerUserId: userId,
    castBlock,
  };
}

/**
 * Instantané partagé d'un tournoi **que ce lecteur a le droit de lire**.
 *
 * Unique porte vers `getTournamentSnapshot` en dehors de ce module : celui-ci
 * ignore `start_visibility_at`, donc un tournoi encore en préparation s'y lisait
 * intégralement pour peu qu'on connaisse son identifiant. La règle vit dans
 * `lib/shared/tournament-visibility.ts`, et les deux portes de lecture — le flux
 * SSE et la lecture REST de secours — passent toutes deux par ici.
 *
 * `null` recouvre les deux cas, « n'existe pas » et « pas pour vous », et
 * l'appelant les traduit en un même 404 : distinguer les deux confirmerait
 * l'existence du tournoi qu'on protège.
 *
 * Un tournoi devenu visible pendant qu'on le lit ne fait qu'élargir l'accès, et
 * l'inverse ne peut pas arriver : l'édition ne rouvre `startVisibilityAt` que
 * dans la fenêtre `FULL`, qui suppose le tournoi encore invisible
 * (`lib/shared/tournament-edit.ts`). Un flux déjà ouvert n'a donc rien à
 * revérifier à chaque trame.
 */
export async function getVisibleTournamentSnapshot(
  tournamentId: number,
  rights: TournamentViewerRights = {},
): Promise<TournamentSnapshot | null> {
  const snapshot = await getTournamentSnapshot(tournamentId);
  if (!snapshot) return null;
  if (!canViewTournament(snapshot.card, { canManage: rights.canManage === true })) return null;
  return snapshot;
}

/**
 * Carte d'un tournoi **que ce lecteur a le droit de lire** — la lecture légère,
 * pour ce qui ne veut que décrire le tournoi (titre et description d'un lien
 * partagé, image d'aperçu).
 *
 * `getVisibleTournamentSnapshot` construit l'instantané entier — tous les
 * matchs, les inscrites, les classements, voire une transaction d'entretien —
 * et l'ouverture d'une fiche le payait une première fois rien que pour ses
 * métadonnées, le cache (3 s) étant souvent expiré quand le flux SSE ouvert
 * après l'hydratation le redemandait. Ici : une seule requête indexée, celle de
 * la ligne de liste, sans rien écrire.
 *
 * Même règle de visibilité, même module pur, même `null` pour « n'existe pas »
 * et « pas pour vous ». Aucun entretien n'étant joué, l'état stocké peut
 * retarder d'une bascule : il est donc **recalculé** depuis les dates, par la
 * règle partagée (`computeTournamentState`) que le client applique aussi —
 * l'encart ne dit pas « inscriptions à venir » d'un tournoi qui les a ouvertes.
 */
export async function getVisibleTournamentCard(
  tournamentId: number,
  rights: TournamentViewerRights = {},
): Promise<TournamentCard | null> {
  const row = await withConnection((connection) => getTournamentListRow(connection, tournamentId));
  if (!row) return null;

  const card = mapCard(row);
  if (!canViewTournament(card, { canManage: rights.canManage === true })) return null;

  return { ...card, state: sharedComputeTournamentState(card) };
}

/**
 * Détail complet du tournoi pour un lecteur donné : l'instantané partagé
 * (mutualisé entre tous les spectateurs, voir `./snapshot`) complété de son
 * contexte personnel.
 */
export async function getTournamentDetail(
  tournamentId: number,
  userId: number,
  rights: TournamentViewerRights = {},
): Promise<TournamentDetail | null> {
  const snapshot = await getVisibleTournamentSnapshot(tournamentId, rights);
  if (!snapshot) return null;

  const viewer = await getTournamentViewerContext(snapshot, userId, rights);
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

const REPORT_DEADLOCK_ATTEMPTS = 3;

/**
 * Rejoue une écriture de résultat annulée par un interblocage InnoDB : les
 * verrous d'intervalle de `bg_match_maps` (`./match-maps`) peuvent opposer deux
 * écritures sur des matchs voisins — report d'équipe ou geste d'arbitrage.
 * Toute autre erreur remonte telle quelle.
 */
async function retryOnDeadlock(write: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await write();
      return;
    } catch (error) {
      if (!isTransactionAborted(error) || attempt >= REPORT_DEADLOCK_ATTEMPTS) throw error;
    }
  }
}

export async function reportMatchScorePublic(
  tournamentId: number,
  matchId: number,
  userId: number,
  maps: ReadonlyArray<MatchMapInput>,
): Promise<void> {
  // Deux reports simultanés sur des matchs voisins peuvent s'interbloquer sur
  // `bg_match_maps` : InnoDB annule l'un, qui est rejoué tel quel plutôt que de
  // rendre un 500 à l'équipe.
  await retryOnDeadlock(() =>
    runPlayerMatchWrite(tournamentId, matchId, (connection) =>
      reportMatchScore(connection, tournamentId, matchId, userId, maps),
    ),
  );
}

/**
 * Forfait d'un engagé sur **sa** manche, déclaré par lui-même
 * (`./player-forfeit`). Même chaîne que le report d'un score : c'est un
 * résultat de match comme un autre, qui doit faire avancer le plateau.
 */
export async function forfeitOwnMatchPublic(
  tournamentId: number,
  matchId: number,
  userId: number,
): Promise<void> {
  const { forfeitOwnMatch } = await import("./player-forfeit");
  // L'entretien qui suit (reports expirés) écrit dans `bg_match_maps` : même
  // risque d'interblocage que le report d'un score (`retryOnDeadlock`).
  await retryOnDeadlock(() =>
    runPlayerMatchWrite(tournamentId, matchId, (connection) =>
      forfeitOwnMatch(connection, tournamentId, matchId, userId),
    ),
  );
}

/**
 * Transaction d'une écriture de résultat **par un engagé** (report de score,
 * forfait sur sa manche), suivie de la chaîne qui en tire les conséquences :
 * reports expirés, exemptions, réconciliation des modes à classement et des
 * phases, clôture du tournoi. Écrite une fois : un chemin joueur qui oublierait
 * une réconciliation laisserait la manche suivante non appariée.
 */
async function runPlayerMatchWrite(
  tournamentId: number,
  matchId: number,
  write: (connection: PoolConnection) => Promise<unknown>,
): Promise<void> {
  const stateBefore = await readTournamentState(tournamentId);
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    await write(connection);

    await resolveExpiredScoreReports(connection, tournamentId);
    await tryAutoResolveByes(connection, tournamentId);

    // Réconcilie les modes à classement (idempotents) avant la finalisation
    // générique. Chacun sort immédiatement si le format ne le concerne pas.
    const { reconcileSurvival } = await import("./survival");
    await reconcileSurvival(tournamentId, connection);
    const { reconcileSwiss } = await import("./swiss");
    await reconcileSwiss(tournamentId, connection);
    const { reconcileEndurance } = await import("./bg-survie/reconcile");
    await reconcileEndurance(tournamentId, connection);

    // Réconcilie les phases multi (idempotent)
    const { reconcilePhases: reconcileMultiPhases } = await import("./phases");
    await reconcileMultiPhases(tournamentId, connection);

    await finalizeTournamentIfDone(connection, tournamentId);

    await connection.commit();

    // Le journal part après le commit : rien n'est annoncé qui ne soit écrit,
    // et une ligne de plus (fin de match, clôture du tournoi) n'allonge pas la
    // réponse rendue à l'équipe qui vient de saisir son score.
    flushBotLogs(connection);

    publishScoreReportedEvent(tournamentId, matchId);
    // L'adversaire a un score à confirmer : il le sait sans avoir la page ouverte.
    void notifyScoreToConfirm(matchId);
    await invalidateListsIfStateChanged(tournamentId, stateBefore);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}

export async function adminSaveMatchScoresPublic(
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
  mapEntry?: AdminMapEntry,
): Promise<void> {
  // Même risque d'interblocage que le report d'un engagé (`retryOnDeadlock`).
  await retryOnDeadlock(() => adminSaveMatchScoresOnce(matchId, team1Score, team2Score, forfeitTeamId, mapEntry));
}

async function adminSaveMatchScoresOnce(
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
  mapEntry?: AdminMapEntry,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { adminSaveMatchScores: adminSaveInternal } = await import("./admin");
    await adminSaveInternal(connection, matchId, team1Score, team2Score, forfeitTeamId, mapEntry);

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
      const { reconcileEndurance } = await import("./bg-survie/reconcile");
      await reconcileEndurance(savedTournamentId, connection);

      const { reconcilePhases: reconcileMultiPhases } = await import("./phases");
      await reconcileMultiPhases(savedTournamentId, connection);
    }

    await connection.commit();
    flushBotLogs(connection);

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
    discardBotLogs(connection);
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
  actingUserId: number | null = null,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Droit relu **dans la transaction**, comme à l'inscription
    // (`registerCurrentUserTeam`) : la route l'a déjà lu pour décider quoi
    // afficher, mais elle l'a fait sur une connexion rendue depuis. Entre les
    // deux, l'appelant a pu être rétrogradé ou sorti du roster — et le geste,
    // lui, ne se défait pas : l'équipe quitte le tournoi, capital à zéro en BG
    // Survie. Le droit d'engager comme celui de désengager se juge à l'instant
    // de l'écriture, pas à celui où la page a été rendue.
    //
    // `null` = arbitrage : le staff `tournaments` forfaite n'importe quel
    // engagé, il n'a pas d'engagé à lui à comparer.
    if (actingUserId !== null) {
      const tournament = await loadTournamentRow(connection, tournamentId);
      if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");

      const entrant = await resolveUserEntrant(connection, tournament, actingUserId);
      if (entrant.teamId === null || entrant.teamId !== teamId) throw new Error("FORBIDDEN");
      if (!entrant.canActForEntrant) throw new Error("NOT_TEAM_MANAGER");
    }

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
      const { forfeitEnduranceTeam } = await import("./bg-survie/forfeit");
      await forfeitEnduranceTeam(tournamentId, teamId, connection);
    } else {
      throw new Error("FORMAT_WITHOUT_FORFEIT");
    }

    if (format === "MULTI") {
      const { reconcilePhases } = await import("./phases");
      await reconcilePhases(tournamentId, connection);
    }

    // La ligne d'abandon est réservée par le moteur du format concerné
    // (survie, suisse, endurance) : elle ne part qu'une fois l'abandon écrit.
    queueBotLog(connection, { kind: "forfeit", tournamentId, teamId });

    await connection.commit();
    flushBotLogs(connection);

    publishUpdatedEvent(tournamentId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}

/**
 * Inflige une pénalité de points d'endurance à un engagé (mode « BlueGenji
 * Survie »). Ouvre sa propre transaction, journalise et publie la mise à jour.
 *
 * Le contrôle de permission appartient à la route : ici, on suppose l'arbitrage
 * déjà établi — comme pour l'abandon forcé juste au-dessus.
 */
export async function applyEndurancePenaltyPublic(
  tournamentId: number,
  teamId: number,
  points: number,
  reason: string,
  authorId: number | null,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { applyEndurancePenalty } = await import("./bg-survie/penalties");
    const applied = await applyEndurancePenalty(
      tournamentId,
      teamId,
      points,
      reason,
      authorId,
      connection,
    );

    // Le motif **tel qu'il est stocké** : le moteur l'a normalisé, et le canal
    // Discord montrerait sinon un espacement que la page ne montre pas.
    queueBotLog(connection, {
      kind: "endurance_penalty",
      tournamentId,
      teamId,
      points,
      reason: applied.reason,
    });

    await connection.commit();
    flushBotLogs(connection);

    publishUpdatedEvent(tournamentId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}

/**
 * Retire une pénalité d'endurance : le rejeu rend les points et défait tout ce
 * que la sanction avait entraîné.
 *
 * La ligne du journal porte l'engagé et le montant **relus avant l'effacement** :
 * la résolution des entrées se fait après le commit, où la ligne n'existe plus.
 */
export async function liftEndurancePenaltyPublic(
  tournamentId: number,
  penaltyId: number,
): Promise<void> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { liftEndurancePenalty } = await import("./bg-survie/penalties");
    const lifted = await liftEndurancePenalty(tournamentId, penaltyId, connection);

    queueBotLog(connection, {
      kind: "endurance_penalty_lifted",
      tournamentId,
      teamId: lifted.teamId,
      points: lifted.points,
    });

    await connection.commit();
    flushBotLogs(connection);

    publishUpdatedEvent(tournamentId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}

export async function adminResolveMatchPublic(
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
  doubleForfeit = false,
  mapEntry?: AdminMapEntry,
): Promise<void> {
  // Même risque d'interblocage que le report d'un engagé (`retryOnDeadlock`).
  await retryOnDeadlock(() =>
    adminResolveMatchOnce(matchId, team1Score, team2Score, forfeitTeamId, doubleForfeit, mapEntry),
  );
}

async function adminResolveMatchOnce(
  matchId: number,
  team1Score?: number,
  team2Score?: number,
  forfeitTeamId?: number,
  doubleForfeit = false,
  mapEntry?: AdminMapEntry,
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
    await adminResolveMatch(
      connection,
      matchId,
      team1Score,
      team2Score,
      forfeitTeamId,
      doubleForfeit,
      mapEntry,
    );

    await tryAutoResolveByes(connection, tournamentId);

    const { reconcileSurvival } = await import("./survival");
    await reconcileSurvival(tournamentId, connection);
    const { reconcileSwiss } = await import("./swiss");
    await reconcileSwiss(tournamentId, connection);
    const { reconcileEndurance } = await import("./bg-survie/reconcile");
    await reconcileEndurance(tournamentId, connection);

    const { reconcilePhases: reconcileMultiPhases } = await import("./phases");
    await reconcileMultiPhases(tournamentId, connection);

    await finalizeTournamentIfDone(connection, tournamentId);

    await connection.commit();
    flushBotLogs(connection);

    publishScoreReportedEvent(tournamentId, matchId);
    // Même raison que pour la sauvegarde de scores : l'état d'avant n'a pas pu
    // être lu, l'id du tournoi ne se découvrant qu'en cours de transaction. Un
    // arbitrage reste rare, contrairement au report de score.
    invalidateTournamentLists();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}
