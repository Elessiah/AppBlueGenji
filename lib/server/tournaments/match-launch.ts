/**
 * Lancement d'un match : « Prêt » des parties, lancement forcé ou d'office,
 * inscription des casters (co-cast d'un stream ou stream à part) et
 * désignation de l'équipe hôte.
 *
 * Toute la règle vit dans le module pur `lib/shared/match-launch.ts` ; ce
 * fichier l'applique à la base, sous le verrou de la ligne du match, et publie
 * l'événement qui réveille les pages ouvertes — les « Prêt » voyagent ensuite
 * dans l'instantané du flux SSE, comme le reste du plateau.
 *
 * Voir `docs/features/MATCH_LAUNCH.md`.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import {
  allPartiesReady,
  canDeclareTeamReady,
  castBeforeLaunch,
  castBlockReason,
  currentLaunchState,
  isAutoLaunchDue,
  launchPairingKey,
  launchReadiness,
  launchStateIsCurrent,
  matchLaunchPhase,
  type CastBlock,
  type CasterIdentity,
  type LaunchViewerRole,
  type MatchLaunchInput,
} from "@/lib/shared/match-launch";
import { isMatchCastable, parseStreamUrlInput, shownStreams, type MatchLiveTrigger } from "@/lib/shared/live-streams";
import { parseCastBattletagInput } from "@/lib/shared/cast-settings";
import {
  groupNoRefereeAlerts,
  normalizeFirstMap,
  refereeDecision,
  type NoRefereeCandidate,
} from "@/lib/shared/match-referee";
import { formatRoundSelfManagementLog } from "@/lib/shared/bot-logs";
import { matchRoundLabel } from "@/lib/shared/discord-notifications";
import { sendBotLog } from "@/lib/server/bot-integration";
import type { MatchStatus, TeamRole, TournamentGame } from "@/lib/shared/types";
import {
  casterIdentityOf,
  loadCastEligibility,
  loadCastBlocks,
  loadEligibleCasterIds,
  loadRefereeEligibility,
  loadRefereeStanding,
  refereeObjectionUpheld,
  type CasterIdentityRow,
  type RefereeStanding,
} from "./cast-eligibility";
import { announceCastChange, queueCastChange } from "./cast-notices";
import { applyCastSettings, PLAIN_CAST_ACCESS, type CastAccess, type CastSettings } from "./cast-settings";
import {
  lockMatchCasters,
  lockMatchStreams,
  pruneMatchStreams,
  type MatchCasterLink,
  type MatchStreamRow,
} from "./match-casters";
import { retryOnDeadlock } from "./deadlock-retry";
import { lockTournamentRow } from "./registration";
import { isTransactionAborted } from "@/lib/server/mysql-errors";
import { activeMemberSql } from "./match-players";
import { announceRefereeChange, announceRefereeChanges, queueRefereeChange, type RefereeChange } from "./referee-notices";
import { loadMatchLogRow, matchLogSubject } from "./match-log-subject";
import { noRefereeAlertKey, queueRefereeAlert, queueRoundNoRefereeAlert } from "./bot-logs";
import { sqlPlaceholders } from "@/lib/server/sql-placeholders";
import { publishMatchUpdatedEvent } from "./notifications";
import { loadRoundSlots } from "./round-map-slots";
import { inTransaction } from "./transaction";
import { nullableId } from "@/lib/shared/nullable-id";

/** La ligne d'un match telle que le lancement la lit, sans ses casters. */
export type LaunchMatchBaseRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_state: string;
  /** Jeu du tournoi : la condition de cast et d'arbitrage en dépend (Battle.net en Overwatch seulement). */
  tournament_game: TournamentGame;
  /** Option du tournoi : matchs planifiés par l'arbitrage (1). */
  referee_scheduling: number | null;
  /** Option du tournoi : phase de lancement (« Prêt », modale) allumée (1). */
  match_launch_phase: number | null;
  status: MatchStatus;
  is_bye: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_is_ghost: number | null;
  team2_is_ghost: number | null;
  start_at: Date | string | null;
  lobby_opened_at: Date | string | null;
  launch_pairing: string | null;
  launched_at: Date | string | null;
  team1_ready_at: Date | string | null;
  team2_ready_at: Date | string | null;
  host_team_id: number | null;
  /** Arbitre désigné (`docs/features/MATCH_REFEREE.md`), son « Prêt », l'autogestion. */
  referee_user_id: number | null;
  referee_ready_at: Date | string | null;
  self_managed: number | null;
  /**
   * Diffusion du match (`lib/shared/live-streams.ts`) : lues sous le verrou
   * parce qu'un caster règle le mode d'antenne en s'inscrivant, et dans la même
   * transaction (`docs/features/CAST_SETTINGS.md`).
   */
  live_trigger: MatchLiveTrigger | null;
  /** Le caster qui a posé le mode d'antenne (`lib/shared/live-trigger-owner.ts`), `null` : le staff. */
  live_trigger_user_id: number | null;
  live_started_at: Date | string | null;
  /** La manche du match : l'alerte « sans arbitre » d'un match sans horaire est groupée par manche. */
  phase_id?: number | null;
  bracket?: string | null;
  round_number?: number | null;
};

/**
 * La ligne d'un match avec ses casters (`bg_match_casters`), relus avec elle :
 * sous verrou par `lockLaunchMatch`, par lot pour la modale.
 */
export type LaunchMatchRow = LaunchMatchBaseRow & {
  casters: MatchCasterLink[];
  /**
   * L'arbitre désigné remplit-il encore la condition d'arbitrage
   * (`refereeEligibilityBlock`) ? Faux sans arbitre. Un arbitre devenu
   * inéligible n'est plus une partie : son « Prêt » n'est pas attendu.
   */
  refereeEligible: boolean;
  /**
   * Ce que le verrou a lu de l'arbitre désigné (`lockLaunchMatch`) : sa
   * condition, son opposition, et s'il joue le match (`null` : non calculé, match
   * déjà lancé ou arbitre déjà écarté). Absent hors verrou (lecture par lot de la
   * modale) : les gestes qui en ont besoin le relisent.
   */
  refereeStanding?: (RefereeStanding & { plays: boolean | null }) | null;
};

const LAUNCH_MATCH_COLUMNS = `
  m.id, m.tournament_id, t.state AS tournament_state, t.game AS tournament_game, t.referee_scheduling, t.match_launch_phase,
  m.status, m.is_bye,
  m.team1_id, m.team2_id, t1.is_ghost AS team1_is_ghost, t2.is_ghost AS team2_is_ghost,
  m.start_at, m.lobby_opened_at, m.launch_pairing, m.launched_at, m.team1_ready_at,
  m.team2_ready_at, m.host_team_id, m.referee_user_id, m.referee_ready_at, m.self_managed,
  m.live_trigger, m.live_trigger_user_id, m.live_started_at,
  m.phase_id, m.bracket, m.round_number`;

const LAUNCH_MATCH_FROM = `
  FROM bg_matches m
  JOIN bg_tournaments t ON t.id = m.tournament_id
  LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
  LEFT JOIN bg_teams t2 ON t2.id = m.team2_id`;

/**
 * L'état de lancement de la ligne **valable pour son appariement courant**
 * (`currentLaunchState`) : ce qui a été posé pour une paire d'équipes que le
 * moteur a depuis remplacée sur place ne compte pas.
 */
export function rowLaunchState(row: LaunchMatchBaseRow) {
  return currentLaunchState(
    {
      launchPairing: row.launch_pairing ?? null,
      lobbyOpenedAt: toIso(row.lobby_opened_at),
      launchedAt: toIso(row.launched_at),
      team1ReadyAt: toIso(row.team1_ready_at),
      team2ReadyAt: toIso(row.team2_ready_at),
    },
    nullableId(row.team1_id),
    nullableId(row.team2_id),
  );
}

export function toLaunchInput(row: LaunchMatchBaseRow): MatchLaunchInput {
  return {
    status: row.status,
    team1Id: nullableId(row.team1_id),
    team2Id: nullableId(row.team2_id),
    startAt: toIso(row.start_at),
    launchedAt: rowLaunchState(row).launchedAt,
    refereeScheduling: Number(row.referee_scheduling ?? 0) === 1,
    launchPhase: Number(row.match_launch_phase ?? 0) === 1,
  };
}

/** Colonne « prêt » de chaque partie de la ligne du match (les casters ont la leur, `bg_match_casters.ready_at`). */
const READY_AT_COLUMNS: Record<
  Exclude<LaunchViewerRole, "CASTER">,
  "team1_ready_at" | "team2_ready_at" | "referee_ready_at"
> = {
  TEAM1: "team1_ready_at",
  TEAM2: "team2_ready_at",
  MATCH_REFEREE: "referee_ready_at",
};

/**
 * Les « Prêt » de la ligne. `casters` remplace ceux de la ligne quand
 * l'appelant les a filtrés (la modale tait un caster inéligible).
 */
export function rowReadiness(row: LaunchMatchRow, casters: readonly MatchCasterLink[] = row.casters) {
  const launch = rowLaunchState(row);
  const current = launchStateIsCurrent(row.launch_pairing ?? null, nullableId(row.team1_id), nullableId(row.team2_id));
  return launchReadiness({
    team1ReadyAt: launch.team1ReadyAt,
    team2ReadyAt: launch.team2ReadyAt,
    team1IsGhost: Number(row.team1_is_ghost ?? 0) === 1,
    team2IsGhost: Number(row.team2_is_ghost ?? 0) === 1,
    casters: casters.map((caster) => ({
      userId: caster.userId,
      readyAt: current ? toIso(caster.readyAt) : null,
    })),
    // Sans arbitre — ou arbitre devenu inéligible —, rien n'est attendu de ce côté.
    referee:
      row.referee_user_id !== null && row.refereeEligible
        ? { readyAt: current ? toIso(row.referee_ready_at) : null }
        : null,
  });
}

/**
 * Rattache l'état de lancement de la ligne à son appariement courant avant
 * toute écriture : si l'empreinte stockée décrit une autre paire d'équipes, les
 * « Prêt », l'ouverture et le lancement qu'elle portait sont effacés en base,
 * puis l'empreinte est réécrite. Sans ce ménage, un « Prêt » posé maintenant
 * côtoierait en base celui de l'équipe d'avant, que la lecture rejetterait
 * pourtant — et l'empreinte neuve le ressusciterait.
 */
async function adoptCurrentPairing(connection: PoolConnection, row: LaunchMatchRow): Promise<void> {
  const key = launchPairingKey(nullableId(row.team1_id), nullableId(row.team2_id));
  if (key === null || row.launch_pairing === key) return;
  await connection.execute(
    `UPDATE bg_matches
     SET launch_pairing = ?, lobby_opened_at = NULL, launched_at = NULL,
         team1_ready_at = NULL, team2_ready_at = NULL, referee_ready_at = NULL
     WHERE id = ?`,
    [key, row.id],
  );
  // Les réservations des annonces (« Prêt », départ, brief du salon,
  // `bg_match_start_notices`) suivent le lancement remis à zéro : un
  // appariement qui revient (A:B → A:C → A:B après deux corrections de score)
  // retrouverait sinon les siennes, et ni l'appel aux « Prêt » ni le brief ne
  // repartiraient à la réouverture — comme pour un lancement défait.
  // Première adoption (empreinte vide) : aucune réservation n'a pu être posée,
  // et le DELETE prendrait un verrou d'intervalle inutile sous le verrou du match.
  // Le check-in (`LOBBY\_BRIEF%`, `./lobby-brief`) reste réservé : réservé par
  // engagée, il ne part qu'une fois par match, réappariement compris — celle
  // qui arrive reçoit le sien, celle qui reste n'est pas rebriefée.
  if (row.launch_pairing !== null) {
    await connection.execute(
      `DELETE FROM bg_match_start_notices WHERE match_id = ? AND phase NOT LIKE 'LOBBY\\_BRIEF%'`,
      [row.id],
    );
  }
  row.launch_pairing = key;
  row.lobby_opened_at = null;
  row.launched_at = null;
  row.team1_ready_at = null;
  row.team2_ready_at = null;
  row.referee_ready_at = null;
  // L'arbitre désigné qui joue l'appariement qui arrive ne peut plus l'arbitrer.
  // Le verrou vient de poser la même question sur les mêmes équipes : sa
  // réponse est reprise (relue seulement quand il ne l'a pas calculée).
  if (row.referee_user_id !== null && (await refereePlaysMatch(connection, row))) {
    const refereeId = Number(row.referee_user_id);
    await connection.execute(`UPDATE bg_matches SET referee_user_id = NULL WHERE id = ?`, [row.id]);
    row.referee_user_id = null;
    row.refereeEligible = false;
    queueRefereeChange(connection, { kind: "AUTO_RELEASED", matchId: Number(row.id), refereeId, reason: "JOINED_TEAM" });
  }
  if (row.casters.length === 0) return;
  await connection.execute(`UPDATE bg_match_casters SET ready_at = NULL WHERE match_id = ?`, [row.id]);
  for (const caster of row.casters) caster.readyAt = null;

  // Un caster peut s'inscrire sur un match dont les créneaux sont encore vides
  // — l'inscription ne peut alors rien vérifier. Si l'appariement qui arrive
  // compte son équipe, il joue ce match : il ne peut plus le caster.
  const playing: number[] = [];
  for (const caster of row.casters) {
    if (await resolveTeamParty(connection, row, caster.userId)) playing.push(caster.userId);
  }
  if (playing.length === 0) return;
  await connection.execute(
    `DELETE FROM bg_match_casters WHERE match_id = ? AND user_id IN (${playing.map(() => "?").join(", ")})`,
    [row.id, ...playing],
  );
  row.casters = row.casters.filter((caster) => !playing.includes(caster.userId));
  await dropTriggerOwner(connection, row, playing);
  await pruneMatchStreams(connection, Number(row.id), { casters: row.casters });
  for (const casterId of playing) {
    // Annoncé comme tout retrait d'office (journal du staff, avis au caster),
    // après le commit de la transaction appelante : `inTransaction` ici,
    // `flushBotLogs` pour l'entretien.
    queueCastChange(connection, { kind: "AUTO_RELEASED", matchId: Number(row.id), casterId, reason: "JOINED_TEAM" });
  }
}

/**
 * Un caster retiré d'office qui avait posé le mode d'antenne n'en est plus le
 * propriétaire : le mode reste au match et revient au staff
 * (`lib/shared/live-trigger-owner.ts`), comme au départ volontaire
 * (`releaseMatchCast`). Sans quoi le staff et les co-casters resteraient
 * refusés (`LIVE_TRIGGER_NOT_OWNED`) au nom d'un caster parti.
 */
async function dropTriggerOwner(
  connection: PoolConnection,
  row: LaunchMatchRow,
  leaving: readonly number[],
): Promise<void> {
  const owner = nullableId(row.live_trigger_user_id);
  if (owner === null || !leaving.includes(owner)) return;
  await connection.execute(`UPDATE bg_matches SET live_trigger_user_id = NULL WHERE id = ?`, [row.id]);
  row.live_trigger_user_id = null;
}

/** L'arbitre désigné joue-t-il le match ? Réponse du verrou quand il l'a calculée. */
async function refereePlaysMatch(connection: PoolConnection, row: LaunchMatchRow): Promise<boolean> {
  const known = row.refereeStanding?.plays;
  if (known !== undefined && known !== null) return known;
  return (await resolveTeamParty(connection, row, Number(row.referee_user_id))) !== null;
}

/** Colonnes propres à la ligne du match, relues sous verrou par `lockLaunchMatch`. */
const LAUNCH_MATCH_OWN_COLUMNS = `
  m.id, m.tournament_id, m.status, m.is_bye, m.team1_id, m.team2_id,
  m.start_at, m.lobby_opened_at, m.launch_pairing, m.launched_at, m.team1_ready_at,
  m.team2_ready_at, m.host_team_id, m.referee_user_id, m.referee_ready_at, m.self_managed,
  m.live_trigger, m.live_trigger_user_id, m.live_started_at,
  m.phase_id, m.bracket, m.round_number`;

/**
 * L'arbitre peut-il encore « jouer le match » ? Avant un lancement **de cet
 * appariement** (un lancement d'avant un réappariement ne compte pas) — la
 * règle de `castBeforeLaunch` et de `KEPT_REFEREE_SQL`, sans exclure un match
 * joué, dont la lecture ne change pas.
 */
function refereePlayCounts(base: LaunchMatchBaseRow): boolean {
  return (
    base.launched_at === null ||
    !launchStateIsCurrent(base.launch_pairing ?? null, nullableId(base.team1_id), nullableId(base.team2_id))
  );
}

/**
 * Relit le match **sous verrou** de sa seule ligne : les tables jointes ne sont
 * que lues, et verrouiller la ligne du tournoi ferait attendre tout le moteur
 * derrière un clic sur « Prêt ».
 *
 * Deux requêtes et non une jointure en `FOR UPDATE OF m` : la production tourne
 * sous **MariaDB**, qui ne connaît pas la clause `OF` (erreur de syntaxe, qui
 * faisait échouer tout lancement anticipé de tournoi), et un `FOR UPDATE` nu
 * sur la jointure verrouillerait aussi le tournoi et les deux équipes. La ligne
 * du match est donc lue seule sous verrou — lecture *courante*, jamais
 * périmée —, puis l'état du tournoi et le statut fantôme des engagées par une
 * lecture ordinaire : le premier est verrouillé par le moteur quand il compte
 * (la transaction qui le modifie le voit), le second ne change pas.
 *
 * Ses casters sont relus ensuite (`lockMatchCasters`, table seule). Verrou du
 * match pris en **première instruction** de la transaction : toute écriture sur
 * un caster passe par lui, l'instantané se prend après (la lecture du contexte,
 * ci-dessous), et une lecture ordinaire suffit — pas de `FOR UPDATE` sur un
 * intervalle vide, que partagent tous les matchs voisins sans caster (deux
 * inscriptions simultanées s'interbloquaient). Quand un instantané a précédé
 * le verrou (`snapshotBeforeLock` : l'entretien des lancements et l'autogestion
 * d'une manche lisent d'abord leurs candidats), seule la lecture verrouillante
 * est *courante* et elle est gardée.
 */
async function lockLaunchMatch(
  connection: PoolConnection,
  matchId: number,
  snapshotBeforeLock = false,
): Promise<LaunchMatchRow | null> {
  const [rows] = await connection.execute<LaunchMatchBaseRow[]>(
    `SELECT ${LAUNCH_MATCH_OWN_COLUMNS} FROM bg_matches m WHERE m.id = ? LIMIT 1 FOR UPDATE`,
    [matchId],
  );
  const base = rows[0];
  if (!base) return null;

  const [context] = await connection.execute<
    (RowDataPacket & {
      tournament_state: string | null;
      tournament_game: TournamentGame | null;
      referee_scheduling: number | null;
      match_launch_phase: number | null;
      team1_is_ghost: number | null;
      team2_is_ghost: number | null;
    })[]
  >(
    `SELECT
       (SELECT state FROM bg_tournaments WHERE id = ?) AS tournament_state,
       (SELECT game FROM bg_tournaments WHERE id = ?) AS tournament_game,
       (SELECT referee_scheduling FROM bg_tournaments WHERE id = ?) AS referee_scheduling,
       (SELECT match_launch_phase FROM bg_tournaments WHERE id = ?) AS match_launch_phase,
       (SELECT is_ghost FROM bg_teams WHERE id = ?) AS team1_is_ghost,
       (SELECT is_ghost FROM bg_teams WHERE id = ?) AS team2_is_ghost`,
    [
      base.tournament_id,
      base.tournament_id,
      base.tournament_id,
      base.tournament_id,
      nullableId(base.team1_id),
      nullableId(base.team2_id),
    ],
  );
  // Même effet que l'ancienne jointure interne : un match dont le tournoi a
  // disparu n'est pas un match à lancer.
  const tournamentState = context[0]?.tournament_state ?? null;
  if (tournamentState === null) return null;
  // Le jeu, lu ici et jamais ailleurs : la condition de cast et d'arbitrage en
  // dépend (Battle.net en Overwatch seulement). Posé **avant** de juger
  // l'arbitre ; un jeu illisible retombe sur Overwatch, la règle la plus stricte.
  base.tournament_game = context[0]?.tournament_game ?? "OW";
  // Avant le départ, un arbitre qui joue désormais le match (roster rejoint
  // sans changer d'appariement) ne compte plus : sinon le lancement attendrait
  // un « Prêt » d'arbitre qu'il ne peut plus donner (il clique en joueur).
  //
  // Condition et opposition se lisent en une seule requête sur sa ligne
  // (`loadRefereeStanding`). Une opposition retenue ferme l'arbitrage : un
  // arbitre que le balayage n'aurait pas retiré (échec en cours de route) ne
  // compte plus, comme un inéligible — le lancement ne l'attend pas, un autre
  // peut prendre le match.
  const refereeId = nullableId(base.referee_user_id);
  let refereeStanding: LaunchMatchRow["refereeStanding"] = null;
  if (refereeId !== null) {
    const standing = await loadRefereeStanding(connection, refereeId, base.tournament_game);
    const plays =
      standing.block === null && !standing.objection && refereePlayCounts(base)
        ? (await resolveTeamParty(connection, base, refereeId)) !== null
        : null;
    refereeStanding = { ...standing, plays };
  }
  const refereeEligible =
    refereeStanding !== null &&
    refereeStanding.block === null &&
    !refereeStanding.objection &&
    refereeStanding.plays !== true;
  const row: LaunchMatchRow = Object.assign(base, {
    casters: await lockMatchCasters(connection, matchId, !snapshotBeforeLock),
    refereeEligible,
    refereeStanding,
  });
  row.tournament_state = tournamentState;
  row.referee_scheduling = context[0]?.referee_scheduling ?? 0;
  row.match_launch_phase = context[0]?.match_launch_phase ?? 0;
  row.team1_is_ghost = context[0]?.team1_is_ghost ?? null;
  row.team2_is_ghost = context[0]?.team2_is_ghost ?? null;
  return row;
}


/** Le lecteur est-il l'arbitre désigné du match, et le reste-t-il (`refereeEligible`) ? */
function isEligibleReferee(
  row: { referee_user_id?: number | null; refereeEligible?: boolean },
  userId: number,
): boolean {
  return row.refereeEligible === true && nullableId(row.referee_user_id ?? null) === userId;
}

/** Partie que le lecteur représente dans ce match, et sa qualité à y agir. */
export type MatchParty = { role: LaunchViewerRole; canDeclareReady: boolean };

/**
 * Le lecteur est-il partie de ce match — joueur d'une des deux engagées
 * (appartenance **en cours**, ou entrée solo), ou un de ses casters ?
 */
export async function resolveMatchParty(
  connection: PoolConnection,
  match: {
    team1_id: number | null;
    team2_id: number | null;
    casters: readonly Pick<MatchCasterLink, "userId">[];
    referee_user_id?: number | null;
    refereeEligible?: boolean;
    /**
     * Jeu du tournoi, requis : un appelant qui l'oublie ne compile pas. `null`
     * (sans casters à juger) retombe sur Overwatch, la règle la plus stricte.
     */
    tournament_game: TournamentGame | null;
  },
  userId: number,
): Promise<MatchParty | null> {
  // Le rôle de joueur prime : qui joue le match ne le caste pas, même si une
  // inscription faite avant que son équipe n'arrive est encore en base.
  const team = await resolveTeamParty(connection, match, userId);
  if (team) return team;
  if (match.casters.some((caster) => caster.userId === userId)) {
    // Une inscription ne vaut que tant que son titulaire remplit la condition
    // du cast : un compte privé de `live` ou d'identité ne déclare plus rien.
    if ((await loadCastEligibility(connection, userId, match.tournament_game ?? "OW")) === null) return { role: "CASTER", canDeclareReady: true };
  }
  // L'arbitre désigné, tant qu'il remplit la condition d'arbitrage. Un arbitre
  // qui caste aussi lit en caster : un seul « Prêt » vaut pour les deux.
  if (isEligibleReferee(match, userId)) {
    return { role: "MATCH_REFEREE", canDeclareReady: true };
  }
  return null;
}

/** Le lecteur joue-t-il ce match — appartenance en cours, ou entrée solo ? */
async function resolveTeamParty(
  connection: PoolConnection,
  match: { team1_id: number | null; team2_id: number | null },
  userId: number,
): Promise<MatchParty | null> {
  const team1Id = nullableId(match.team1_id);
  const team2Id = nullableId(match.team2_id);
  const teamIds = [team1Id, team2Id].filter((id): id is number => id !== null);
  if (teamIds.length === 0) return null;
  const placeholders = teamIds.map(() => "?").join(", ");

  const [solo] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_teams WHERE solo_user_id = ? AND id IN (${placeholders}) LIMIT 1`,
    [userId, ...teamIds],
  );
  if (solo.length > 0) {
    return { role: Number(solo[0].id) === team1Id ? "TEAM1" : "TEAM2", canDeclareReady: true };
  }

  const [members] = await connection.execute<
    (RowDataPacket & { team_id: number; roles_json: unknown })[]
  >(
    `SELECT team_id, roles_json FROM bg_team_members tm
     WHERE tm.user_id = ? AND ${activeMemberSql("tm")} AND tm.team_id IN (${placeholders})
     LIMIT 1`,
    [userId, ...teamIds],
  );
  if (members.length === 0) return null;
  const roles: TeamRole[] = parseRoles(members[0].roles_json);
  return {
    role: Number(members[0].team_id) === team1Id ? "TEAM1" : "TEAM2",
    canDeclareReady: canDeclareTeamReady(roles),
  };
}

/**
 * Lance le match si toutes les parties attendues sont prêtes. Appelée après
 * chaque écriture qui peut compléter la liste (un « Prêt », le départ d'un caster).
 *
 * `snapshotBeforeLock` : la transaction a lu avant le verrou du match
 * (autogestion d'une manche) — casters et éligibilité se relisent alors en
 * lecture courante, sinon un caster inscrit depuis l'instantané ne serait pas
 * attendu (`lockLaunchMatch`, `releaseIneligibleCasters`).
 *
 * `locked` : la ligne que l'appelant tient déjà sous verrou, à jour de ce qu'il
 * vient d'écrire (`setMatchReady`) — elle n'est pas verrouillée une seconde fois.
 *
 * Un match qui part ainsi sans arbitre ni autogestion — l'arbitre vient d'être
 * retiré, par exemple — avertit le staff comme un départ de l'entretien
 * (`queueNoRefereeAlerts`, une seule alerte par appariement). `undecided` :
 * un retrait en série (opposition, lecture des contacts) y recueille ces
 * matchs pour les signaler **ensemble** à la fin (`queueDeferredNoRefereeAlerts`),
 * regroupés par manche, plutôt qu'une alerte par match.
 */
async function launchIfAllReady(
  connection: PoolConnection,
  matchId: number,
  snapshotBeforeLock = false,
  locked?: LaunchMatchRow,
  undecided?: NoRefereeCandidate[],
): Promise<boolean> {
  const row = locked ?? (await lockLaunchMatch(connection, matchId, snapshotBeforeLock));
  if (!row) return false;
  if (!locked) await adoptCurrentPairing(connection, row);
  if (matchLaunchPhase(toLaunchInput(row), Date.now()) !== "LOBBY") return false;
  // Un caster devenu inéligible ne donnera plus son « Prêt » : il est retiré
  // avant le décompte, sinon le match l'attendrait jusqu'au lancement d'office.
  await releaseIneligibleCasters(connection, row, snapshotBeforeLock);
  if (!allPartiesReady(rowReadiness(row))) return false;
  await connection.execute(`UPDATE bg_matches SET launched_at = NOW() WHERE id = ?`, [matchId]);
  const candidate = undecidedCandidate(row);
  if (candidate && undecided) undecided.push(candidate);
  else if (candidate) await queueNoRefereeAlerts(connection, [candidate]);
  return true;
}

/**
 * Signale ensemble, après coup, les matchs partis sans arbitre lors d'un
 * retrait en série (`launchIfAllReady`, paramètre `undecided`) : une
 * transaction à part, regroupée par manche ; les réservations par appariement
 * écartent ce qui serait déjà signalé. Ne lève jamais.
 */
export async function queueDeferredNoRefereeAlerts(candidates: readonly NoRefereeCandidate[]): Promise<void> {
  if (candidates.length === 0) return;
  try {
    await retryOnDeadlock(() => inTransaction((connection) => queueNoRefereeAlerts(connection, candidates)));
  } catch (error) {
    console.error("[match-launch] alerte « sans arbitre » non réservée", error);
  }
}

/**
 * « Prêt » d'un caster : le sien seul change. L'arbitre désigné qui caste
 * aussi le match donne les deux d'un clic.
 */
async function writeCasterReady(
  connection: PoolConnection,
  row: LaunchMatchRow,
  userId: number,
  ready: boolean,
): Promise<void> {
  const stamp = ready ? "NOW()" : "NULL";
  await connection.execute(`UPDATE bg_match_casters SET ready_at = ${stamp} WHERE match_id = ? AND user_id = ?`, [
    Number(row.id),
    userId,
  ]);
  const readyAt = ready ? new Date() : null;
  for (const caster of row.casters) if (caster.userId === userId) caster.readyAt = readyAt;
  const alsoReferee = isEligibleReferee(row, userId);
  if (alsoReferee) row.referee_ready_at = readyAt;
  const refereeReady = alsoReferee ? `, referee_ready_at = ${stamp}` : "";
  await connection.execute(
    `UPDATE bg_matches SET lobby_opened_at = COALESCE(lobby_opened_at, NOW())${refereeReady} WHERE id = ?`,
    [Number(row.id)],
  );
}

/**
 * Déclare (ou retire) le « Prêt » de la partie du lecteur. Le retrait n'est
 * possible que tant que le match n'est pas lancé : une fois parti, il l'est.
 *
 * @throws `MATCH_NOT_FOUND` | `TOURNAMENT_NOT_RUNNING` | `MATCH_ALREADY_LAUNCHED`
 *   | `MATCH_NOT_IN_LOBBY` | `NOT_MATCH_PARTY` | `NOT_TEAM_READY_ROLE`
 */
export async function setMatchReady(
  matchId: number,
  userId: number,
  ready: boolean,
): Promise<{ launched: boolean }> {
  const { tournamentId, launched } = await inTransaction(async (connection) => {
    const row = await lockLaunchMatch(connection, matchId);
    if (!row) throw new Error("MATCH_NOT_FOUND");
    if (row.tournament_state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
    const phase = matchLaunchPhase(toLaunchInput(row), Date.now());
    if (phase === "LAUNCHED") throw new Error("MATCH_ALREADY_LAUNCHED");
    if (phase !== "LOBBY") throw new Error("MATCH_NOT_IN_LOBBY");

    await adoptCurrentPairing(connection, row);
    const party = await resolveMatchParty(connection, row, userId);
    if (!party) throw new Error("NOT_MATCH_PARTY");
    if (!party.canDeclareReady) throw new Error("NOT_TEAM_READY_ROLE");

    if (party.role === "CASTER") {
      await writeCasterReady(connection, row, userId, ready);
    } else {
      // Nom de colonne tiré d'une table fermée, jamais de l'entrée.
      const column = READY_AT_COLUMNS[party.role];
      await connection.execute(
        `UPDATE bg_matches
         SET ${column} = ${ready ? "NOW()" : "NULL"},
             lobby_opened_at = COALESCE(lobby_opened_at, NOW())
         WHERE id = ?`,
        [matchId],
      );
      row[column] = ready ? new Date() : null;
    }
    row.lobby_opened_at ??= new Date();
    // La ligne est tenue sous verrou depuis le début et à jour de l'écriture :
    // le décompte la reprend sans la reverrouiller.
    const launchedNow = ready ? await launchIfAllReady(connection, matchId, false, row) : false;
    return { tournamentId: Number(row.tournament_id), launched: launchedNow };
  });
  publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  return { launched };
}

/**
 * Lance le match sans attendre les « Prêt » manquants (arbitrage). Possible
 * dès que le match est jouable, heure de début atteinte ou non — et même **à
 * planifier** : forcer est un geste d'arbitrage, il vaut planification.
 *
 * @throws `MATCH_NOT_FOUND` | `TOURNAMENT_NOT_RUNNING` | `MATCH_ALREADY_LAUNCHED`
 *   | `MATCH_NOT_LAUNCHABLE`
 */
export async function forceLaunchMatch(matchId: number): Promise<void> {
  const tournamentId = await inTransaction(async (connection) => {
    const row = await lockLaunchMatch(connection, matchId);
    if (!row) throw new Error("MATCH_NOT_FOUND");
    if (row.tournament_state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
    // Jugé phase **allumée** : « déjà lancé » veut dire `launched_at` posé. Sur
    // un tournoi sans lancement, un match à l'heure passée que l'entretien n'a
    // pas encore écrit serait sinon refusé (`MATCH_ALREADY_LAUNCHED`) sans que
    // rien ne soit enregistré ; forcer l'enregistre.
    const phase = matchLaunchPhase({ ...toLaunchInput(row), launchPhase: true }, Date.now());
    if (phase === "LAUNCHED") throw new Error("MATCH_ALREADY_LAUNCHED");
    if (phase === "NONE") throw new Error("MATCH_NOT_LAUNCHABLE");
    await adoptCurrentPairing(connection, row);
    await releaseIneligibleCasters(connection, row);
    await connection.execute(
      `UPDATE bg_matches
       SET launched_at = NOW(), lobby_opened_at = COALESCE(lobby_opened_at, NOW())
       WHERE id = ?`,
      [matchId],
    );
    return Number(row.tournament_id);
  });
  publishMatchUpdatedEvent(tournamentId, { landingLive: true });
}

/**
 * Identité d'un caster telle que la règle de `castBlockReason` la lit.
 * `lock` : lecture verrouillée (partagée) de la ligne du compte, pour une
 * inscription — la suppression du compte la tient en exclusif : ou bien
 * l'inscription attend qu'elle soit validée et lit le compte supprimé, ou bien
 * la suppression attend l'inscription et la retire (`withdrawUserCasts`).
 */
export async function loadCasterIdentity(
  connection: PoolConnection,
  userId: number,
  lock = false,
): Promise<CasterIdentity> {
  const [rows] = await connection.execute<CasterIdentityRow[]>(
    `SELECT discord_verified_at, discord_pseudo, blizzard_sub, overwatch_battletag, overwatch_battletag_typed, is_deleted
     FROM bg_users WHERE id = ? LIMIT 1${lock ? " LOCK IN SHARE MODE" : ""}`,
    [userId],
  );
  return casterIdentityOf(rows[0]);
}

/**
 * Ce qui empêche un lecteur de s'inscrire comme caster, `null` s'il le peut.
 * L'identité n'est lue que quand elle peut changer la réponse : sans la
 * permission `live`, le refus est acquis.
 */
export async function loadViewerCastBlock(
  userId: number,
  hasLivePermission: boolean,
  game: TournamentGame,
): Promise<CastBlock | null> {
  if (!hasLivePermission) return castBlockReason(false, { discordVerified: false, blizzardLinked: false }, game);
  const identity = await withConnection((connection) => loadCasterIdentity(connection, userId));
  return castBlockReason(true, identity, game);
}

/**
 * Où un caster s'inscrit : **co-cast** d'un stream existant du match
 * (`streamId`, aucun lien de plus), ou stream **à part** (`liveUrl`, le lien de
 * sa chaîne, **obligatoire** depuis `docs/features/CAST_SETTINGS.md` : un stream
 * sans lien ne paraissait nulle part et n'annonçait donc rien).
 */
export type CastTarget = { streamId: number } | { liveUrl: string };

/**
 * Le stream est-il montré ? La règle de `shownStreams` (celle de `mapMatch`) :
 * celui du staff, ou celui d'un match lancé, l'est toujours ; avant le
 * lancement, celui qu'aucun caster éligible ne tient est tu — le rejoindre
 * ferait réapparaître la chaîne d'un caster que le site ne montre plus. Les
 * casters sont ceux relus avec le match ; leur éligibilité se relit **en une
 * lecture courante** (`LOCK IN SHARE MODE`) : une permission retirée pendant
 * l'attente du verrou du match est vue.
 */
async function streamShown(connection: PoolConnection, row: LaunchMatchRow, stream: MatchStreamRow): Promise<boolean> {
  // Lancé sur **cet** appariement seulement, comme l'instantané (`castBeforeLaunch`).
  const settled = !castBeforeLaunch(row);
  const holders = row.casters.filter((caster) => caster.streamId === stream.id).map((caster) => caster.userId);
  let held = false;
  if (!stream.staff && !settled && holders.length > 0) {
    held = (await loadEligibleCasterIds(connection, holders, row.tournament_game, true)).size > 0;
  }
  return shownStreams([stream], held ? new Set([stream.id]) : new Set<number>(), settled).length > 0;
}

/**
 * Retire les inscriptions des casters qui ne remplissent plus la condition du
 * cast (`castEligibilityBlock`, relue en une lecture), avec les streams qu'ils
 * étaient seuls à tenir — avant un décompte de « Prêt » ou un lancement, dans la
 * transaction qui le décide : sans cela le match attend un « Prêt » qui ne
 * viendra pas, ou, lancé d'office, redonne aux vues publiques le pseudo et le
 * lien d'un caster que le site taisait. Un match déjà lancé garde ses casters
 * (on ne retire pas un caster en pleine diffusion). Chaque retrait s'annonce
 * après le commit, comme tout retrait d'office (`queueCastChange`).
 *
 * `currentRead` : un instantané a précédé le verrou du match (entretien des
 * lancements) — l'éligibilité se relit alors en lecture *courante*, sinon une
 * permission retirée depuis l'instantané ne serait pas vue et le lancement
 * rendrait public le caster.
 *
 * Rend `true` quand au moins un caster a été retiré.
 */
async function releaseIneligibleCasters(
  connection: PoolConnection,
  row: LaunchMatchRow,
  currentRead = false,
): Promise<boolean> {
  if (row.casters.length === 0 || row.launched_at !== null || row.status === "COMPLETED") return false;
  const blocks = await loadCastBlocks(
    connection,
    row.casters.map((caster) => caster.userId),
    row.tournament_game,
    currentRead,
  );
  const leaving = row.casters.filter((caster) => blocks.get(caster.userId) !== null);
  if (leaving.length === 0) return false;
  await connection.execute(
    `DELETE FROM bg_match_casters WHERE match_id = ? AND user_id IN (${leaving.map(() => "?").join(", ")})`,
    [row.id, ...leaving.map((caster) => caster.userId)],
  );
  row.casters = row.casters.filter((caster) => blocks.get(caster.userId) === null);
  await dropTriggerOwner(
    connection,
    row,
    leaving.map((caster) => caster.userId),
  );
  await pruneMatchStreams(connection, Number(row.id), { casters: row.casters });
  for (const caster of leaving) {
    queueCastChange(connection, {
      kind: "AUTO_RELEASED",
      matchId: Number(row.id),
      casterId: caster.userId,
      reason: "INELIGIBLE",
      block: blocks.get(caster.userId) ?? null,
    });
  }
  return true;
}

/**
 * Inscrit le lecteur comme caster du match, sans plafond : sur un stream
 * existant (co-cast) ou sur un stream qu'il ouvre (`target`, avec le lien de sa
 * chaîne — obligatoire). `hasLivePermission` est la permission `live`, établie
 * par la route. Un caster déjà inscrit sur le match n'est pas réinscrit (rien
 * ne change, pas même son stream : il se retire d'abord pour en changer).
 *
 * `settings` : ce que la fenêtre d'inscription règle du même geste et dans la
 * même transaction (`docs/features/CAST_SETTINGS.md`) — mode de passage à
 * l'antenne du match, BattleTag donné pour ce cast. Une inscription déjà
 * acquise n'en réécrit rien.
 *
 * @throws `NOT_CASTER` | `CASTER_IDENTITY_REQUIRED` | `MATCH_NOT_FOUND`
 *   | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE` | `CASTER_IS_PLAYER`
 *   | `STREAM_NOT_FOUND` | `INVALID_STREAM_URL` | `STREAM_URL_REQUIRED`
 *   | `INVALID_LIVE_TRIGGER` | `MATCH_NOT_CASTABLE` | `MATCH_START_AT_REQUIRED`
 *   | `INVALID_CAST_BATTLETAG` | `LIVE_TRIGGER_NOT_OWNED`
 *
 * `access` (admin, permission `tournaments`) décide s'il peut changer un mode
 * d'antenne déjà posé par un autre (`mayChangeLiveTrigger`). Un mode qu'un
 * autre a posé pendant que la fenêtre était ouverte ne refuse pas
 * l'inscription : il reste tel quel, et le résultat le dit (`triggerSkipped`).
 */
export async function claimMatchCast(
  matchId: number,
  userId: number,
  hasLivePermission: boolean,
  target: CastTarget,
  settings: CastSettings = {},
  access: CastAccess = PLAIN_CAST_ACCESS,
): Promise<{ triggerSkipped: boolean }> {
  const castTarget: CastTarget = target;
  // Le lien est jugé avant toute lecture : un refus ne coûte rien. Un stream
  // ouvert sans lien n'apparaissait sur aucune vue et n'annonçait rien : le
  // lien est exigé ici comme la fenêtre l'exige (`STREAM_URL_REQUIRED`).
  let liveUrl: string | null = null;
  if ("liveUrl" in castTarget) {
    liveUrl = parseStreamUrlInput(castTarget.liveUrl);
    if (liveUrl === null) throw new Error("STREAM_URL_REQUIRED");
  }
  // Le BattleTag de cast aussi : une saisie illisible se refuse sans rien lire.
  if (settings.battletag !== undefined) parseCastBattletagInput(settings.battletag);
  // Deux inscriptions simultanées se croisent sur les verrous d'intervalle
  // d'InnoDB : l'interblocage se rejoue.
  const { tournamentId, claimed, triggerSkipped } = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      // Ligne du compte verrouillée en première instruction, avant le match —
      // l'ordre de la suppression de compte (compte, puis ses matchs).
      const identity = await loadCasterIdentity(connection, userId, true);

      // Le jeu vient du match verrouillé : aucune lecture avant son verrou (elle figerait l'instantané).
      const row = await lockLaunchMatch(connection, matchId);
      if (!row) throw new Error("MATCH_NOT_FOUND");
      const block = castBlockReason(hasLivePermission, identity, row.tournament_game);
      if (block) throw new Error(block);
      if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
      if (Number(row.is_bye) === 1) throw new Error("MATCH_NOT_LAUNCHABLE");
      if (row.casters.some((caster) => caster.userId === userId)) {
        return { tournamentId: Number(row.tournament_id), claimed: false, triggerSkipped: false };
      }
      // Seul **jouer** le match ferme le cast : l'arbitre désigné peut le
      // caster (`resolveMatchParty` le rendrait `MATCH_REFEREE`, à tort refusé).
      if (await resolveTeamParty(connection, row, userId)) throw new Error("CASTER_IS_PLAYER");

      let streamId: number;
      if ("streamId" in castTarget) {
        const streams = await lockMatchStreams(connection, matchId, true);
        const stream = streams.find((candidate) => candidate.id === castTarget.streamId);
        if (!stream || !(await streamShown(connection, row, stream))) throw new Error("STREAM_NOT_FOUND");
        streamId = castTarget.streamId;
      } else {
        // Le lien est rattaché à celui qui le fournit : son effacement de
        // compte le retire (`withdrawUserCasts`) — sauf le lien dit de
        // l'organisation (`asOrganisation`, permission `tournaments` vérifiée
        // par la route), qui reste au match comme celui du staff.
        const [created] = await connection.execute<ResultSetHeader>(
          `INSERT INTO bg_match_streams (match_id, live_url, link_user_id) VALUES (?, ?, ?)`,
          [matchId, liveUrl, liveUrl === null || settings.asOrganisation === true ? null : userId],
        );
        streamId = Number(created.insertId);
      }
      // Inscrit sans « Prêt », arbitre désigné compris : un « Prêt » d'arbitre
      // peut dater d'un cycle de lancement révolu (report, appariement). Son
      // clic suivant, en caster, donne les deux (`writeCasterReady`).
      await connection.execute(
        `INSERT INTO bg_match_casters (match_id, user_id, stream_id, ready_at) VALUES (?, ?, ?, NULL)`,
        [matchId, userId, streamId],
      );
      // Réglages du même geste (mode d'antenne, BattleTag du cast) : le lien,
      // lui, vient d'être posé avec le stream (`target`) — le repasser ici le
      // réécrirait, et la route ne l'envoie pas.
      // Le mode d'antenne ne s'écrit que s'il change, et sur un match encore
      // castable : la fenêtre envoie toujours celui qu'elle montre (celui du
      // match par défaut), et un match dont le score attend sa confirmation
      // s'inscrit toujours — seul son mode ne bouge plus (`isMatchCastable`).
      const castable = isMatchCastable({
        status: row.status,
        liveTrigger: row.live_trigger ?? null,
        liveStartedAt: row.live_started_at ?? null,
        launchedAt: null,
      });
      const trigger =
        settings.trigger === undefined || settings.trigger === (row.live_trigger ?? null) || !castable
          ? undefined
          : settings.trigger;
      const outcome = await applyCastSettings(
        connection,
        row,
        userId,
        streamId,
        { ...settings, trigger, liveUrl: undefined, skipLockedTrigger: true },
        access,
      );
      return { tournamentId: Number(row.tournament_id), claimed: true, triggerSkipped: outcome.triggerSkipped };
    }),
  );
  // Une inscription change ce que montrent l'accueil et ses bandeaux (un
  // lien neuf, ou un co-caster éligible dont le stream jusque-là tu devient
  // visible) ; une inscription déjà acquise ne change rien.
  publishMatchUpdatedEvent(tournamentId, { landingLive: claimed });
  // Après le commit : journal du staff. Aucune place n'est reprise à personne.
  if (claimed) announceCastChange({ kind: "CLAIMED", matchId, casterId: userId, replacedCasterId: null });
  return { triggerSkipped };
}

/**
 * Enregistre les réglages de **son** cast, pour un caster inscrit sur le match
 * (fenêtre « Configurer ma diffusion », `docs/features/CAST_SETTINGS.md`) : mode
 * de passage à l'antenne du match, lien de son stream, BattleTag donné pour ce
 * cast. Chaque champ absent n'est pas touché.
 *
 * `hasLivePermission` est la permission `live`, établie par la route : un compte
 * qui l'a perdue n'a plus rien à régler — son inscription part d'office
 * (`releaseIneligibleCast`) et son stream est déjà tu.
 *
 * Tout passe par le verrou de la ligne du match, pris en **première
 * instruction** comme pour l'inscription : les streams et les casters ne
 * s'écrivent que sous lui.
 *
 * @throws `NOT_CASTER` | `MATCH_NOT_FOUND` | `NOT_MATCH_CASTER`
 *   | `MATCH_ALREADY_COMPLETED` | `INVALID_LIVE_TRIGGER` | `MATCH_NOT_CASTABLE`
 *   | `MATCH_START_AT_REQUIRED` | `INVALID_STREAM_URL` | `CAST_STREAM_NOT_OWNED`
 *   | `INVALID_CAST_BATTLETAG` | `STREAM_NOT_FOUND` | `LIVE_TRIGGER_NOT_OWNED`
 */
export async function setCastSettings(
  matchId: number,
  userId: number,
  hasLivePermission: boolean,
  settings: CastSettings,
  access: CastAccess = PLAIN_CAST_ACCESS,
): Promise<void> {
  if (!hasLivePermission) throw new Error("NOT_CASTER");
  // Le lien et le BattleTag sont jugés avant toute lecture : un refus ne coûte rien.
  if (settings.liveUrl !== undefined) parseStreamUrlInput(settings.liveUrl);
  if (settings.battletag !== undefined) parseCastBattletagInput(settings.battletag);

  const tournamentId = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockLaunchMatch(connection, matchId);
      if (!row) throw new Error("MATCH_NOT_FOUND");
      const caster = row.casters.find((entry) => entry.userId === userId);
      if (!caster) throw new Error("NOT_MATCH_CASTER");
      // Un match joué est de l'histoire : son mode, son lien et le BattleTag
      // qui a servi restent tels quels (l'inscription et le retrait refusent de
      // même de le réécrire). Sa rediff, elle, a sa propre route.
      if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
      await applyCastSettings(connection, row, userId, caster.streamId, settings, access);
      return Number(row.tournament_id);
    }),
  );
  // Un mode, un lien ou un stream retiré change ce que montrent l'accueil, ses
  // bandeaux et l'annonce #live : même éviction qu'une configuration du staff.
  publishMatchUpdatedEvent(tournamentId, { landingLive: true });
}

/**
 * Retire un caster du match (`casterId`, par défaut le lecteur) — le sien, ou
 * n'importe lequel pour l'arbitrage (`canManage`, permission `tournaments`).
 * Un stream que plus personne ne tient disparaît avec lui (`pruneMatchStreams`).
 * Si toutes les autres parties étaient prêtes et n'attendaient que lui, le
 * match part.
 *
 * @throws `MATCH_NOT_FOUND` | `NOT_MATCH_CASTER` | `MATCH_ALREADY_COMPLETED`
 */
export async function releaseMatchCast(
  matchId: number,
  userId: number,
  canManage: boolean,
  casterId: number = userId,
): Promise<void> {
  const { tournamentId, releasedCasterId } = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockLaunchMatch(connection, matchId);
      if (!row) throw new Error("MATCH_NOT_FOUND");
      if (casterId !== userId && !canManage) throw new Error("NOT_MATCH_CASTER");
      if (!row.casters.some((caster) => caster.userId === casterId)) {
        return { tournamentId: Number(row.tournament_id), releasedCasterId: null };
      }
      // Un match joué est de l'histoire : l'inscription, son stream et son lien
      // restent (l'inscription et l'anonymisation refusent de même de le réécrire).
      if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");

      await connection.execute(`DELETE FROM bg_match_casters WHERE match_id = ? AND user_id = ?`, [matchId, casterId]);
      const remaining = row.casters.filter((caster) => caster.userId !== casterId);
      await pruneMatchStreams(connection, matchId, { casters: remaining });
      // L'inscription marque le match casté (`CAST_SETTINGS.md`) : le dernier
      // caster parti sans qu'aucun stream reste (ni celui du staff avec son
      // lien), le match n'est plus casté — sans quoi il passerait « En direct »
      // à son lancement sans que personne ne diffuse.
      let unmarked = false;
      if (remaining.length === 0 && (row.live_trigger ?? null) !== null) {
        const left = await lockMatchStreams(connection, matchId, true);
        if (left.length === 0) {
          await connection.execute(
            `UPDATE bg_matches SET live_trigger = NULL, live_trigger_user_id = NULL, live_started_at = NULL WHERE id = ?`,
            [matchId],
          );
          unmarked = true;
        }
      }
      // Le caster qui avait posé le mode s'en va, le mode reste (d'autres
      // streams tiennent) : il n'a plus de propriétaire et revient au staff
      // (`lib/shared/live-trigger-owner.ts`).
      if (!unmarked && Number(row.live_trigger_user_id ?? 0) === casterId) {
        await connection.execute(`UPDATE bg_matches SET live_trigger_user_id = NULL WHERE id = ?`, [matchId]);
      }
      if (row.tournament_state === "RUNNING") await launchIfAllReady(connection, matchId);
      return { tournamentId: Number(row.tournament_id), releasedCasterId: casterId };
    }),
  );
  // Un retrait qui ne retire rien (double clic, carte périmée) ne vide pas le
  // cache de l'accueil et ne pousse rien aux lecteurs.
  if (releasedCasterId !== null) publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  if (releasedCasterId !== null) {
    announceCastChange({ kind: "RELEASED", matchId, casterId: releasedCasterId, byStaff: releasedCasterId !== userId });
  }
}

/**
 * Retire l'inscription d'un caster qui ne remplit plus la condition de
 * `castBlockReason` (permission `live` retirée, tag décertifié, Battle.net
 * détaché, compte supprimé). Tout est **relu sous verrou** : si l'inscription a
 * changé de titulaire, si le match a été lancé ou joué, ou si le compte est redevenu
 * éligible entre la lecture et l'écriture, rien n'est fait. Comme au retrait volontaire, un match qui
 * n'attendait plus que ce caster part.
 *
 * @returns vrai si l'inscription a été retirée.
 */
export async function releaseIneligibleCast(matchId: number, casterId: number): Promise<boolean> {
  let tournamentId: number | null = null;
  let reason: "INELIGIBLE" | "JOINED_TEAM" = "INELIGIBLE";
  let block: CastBlock | null = null;
  await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      // Un nouvel essai (interblocage) relit tout : rien ne reste de l'essai précédent.
      reason = "INELIGIBLE";
      block = null;
      tournamentId = null;
      const row = await lockLaunchMatch(connection, matchId);
      if (!row?.casters.some((caster) => caster.userId === casterId)) return;
      // Seul un match qui attend encore son lancement est concerné. Un match
      // lancé n'attend plus aucun « Prêt » (l'inscription y reste, la lecture
      // des contacts la tait) ; un match joué entre la lecture et ce verrou est
      // de l'histoire, qu'on ne réécrit pas.
      if (row.status === "COMPLETED") return;
      // Phase allumée : lancé = `launched_at` posé, y compris sans phase de
      // lancement (heure passée, entretien pas encore passé : pas encore lancé).
      const phase = matchLaunchPhase({ ...toLaunchInput(row), launchPhase: true }, Date.now());
      if (phase !== "TO_PLAN" && phase !== "SCHEDULED" && phase !== "LOBBY") return;
      // Un caster devenu joueur du match (équipe rejointe après l'inscription,
      // que `CASTER_IS_PLAYER` ne contrôle qu'à l'inscription) ne donnera jamais
      // son « Prêt » de caster : son inscription bloquerait le départ jusqu'au
      // lancement d'office.
      // Le motif dit au caster : les conditions du cast d'abord, l'équipe ensuite.
      block = await loadCastEligibility(connection, casterId, row.tournament_game);
      if (block === null) {
        if ((await resolveTeamParty(connection, row, casterId)) === null) return;
        reason = "JOINED_TEAM";
      }

      await connection.execute(`DELETE FROM bg_match_casters WHERE match_id = ? AND user_id = ?`, [matchId, casterId]);
      await dropTriggerOwner(connection, row, [casterId]);
      await pruneMatchStreams(connection, matchId, {
        casters: row.casters.filter((caster) => caster.userId !== casterId),
      });
      if (row.tournament_state === "RUNNING") await launchIfAllReady(connection, matchId);
      tournamentId = Number(row.tournament_id);
    }),
  );
  if (tournamentId === null) return false;
  publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  announceCastChange({ kind: "AUTO_RELEASED", matchId, casterId, reason, block });
  return true;
}

/**
 * Désigne l'équipe qui héberge la partie ; `null` rend la main au défaut
 * (équipe 1). Aucune garde d'état : c'est une information d'organisation.
 *
 * @returns `true` quand l'hôte a changé — renvoyer le même hôte ne change rien,
 *   et le journal du staff ne le note pas.
 * @throws `MATCH_NOT_FOUND` | `INVALID_HOST_TEAM`
 */
export async function setMatchHost(matchId: number, teamId: number | null): Promise<boolean> {
  const { tournamentId, changed } = await inTransaction(async (connection) => {
    const row = await lockLaunchMatch(connection, matchId);
    if (!row) throw new Error("MATCH_NOT_FOUND");
    if (
      teamId !== null &&
      teamId !== nullableId(row.team1_id) &&
      teamId !== nullableId(row.team2_id)
    ) {
      throw new Error("INVALID_HOST_TEAM");
    }
    // Verrou du match tenu : `changed` est exact. Même hôte = ni écriture ni
    // événement (chaque événement reconstruit l'instantané de tous les lecteurs).
    const changed = nullableId(row.host_team_id) !== teamId;
    if (changed) {
      await connection.execute(`UPDATE bg_matches SET host_team_id = ? WHERE id = ?`, [teamId, matchId]);
    }
    return { tournamentId: Number(row.tournament_id), changed };
  });
  if (changed) publishMatchUpdatedEvent(tournamentId);
  return changed;
}

/**
 * Le match entre-t-il en lancement **sans arbitre ni autogestion** ? Rend sa
 * candidature à l'alerte du staff, `null` s'il a une décision (ou pas encore
 * ses deux engagées). Rien d'autre : le match part comme avant, jamais
 * d'autogestion d'office (décision de l'utilisateur, 2026-10-26).
 */
function undecidedCandidate(row: LaunchMatchRow): NoRefereeCandidate | null {
  // Sans phase de lancement, le match part à la passe qui le verrait : personne
  // n'aurait le temps de désigner un arbitre, et l'alerte ne ferait que remplir
  // la file. Contre une fantôme, il n'y a rien à arbitrer.
  if (Number(row.match_launch_phase ?? 0) !== 1) return null;
  if (Number(row.team1_is_ghost ?? 0) === 1 || Number(row.team2_is_ghost ?? 0) === 1) return null;
  const decision = refereeDecision({
    refereeAssigned: row.referee_user_id !== null && row.refereeEligible,
    selfManaged: Number(row.self_managed ?? 0) === 1,
  });
  const pairing = launchPairingKey(nullableId(row.team1_id), nullableId(row.team2_id));
  if (decision !== "UNDECIDED" || pairing === null) return null;
  return {
    matchId: Number(row.id),
    pairing,
    scheduled: row.start_at !== null,
    phaseId: Number(row.phase_id ?? 0),
    bracket: String(row.bracket ?? ""),
    roundNumber: Number(row.round_number ?? 0),
  };
}

/**
 * Avertit le staff des matchs entrés en lancement sans décision, dans la
 * transaction de l'entretien (alerte d'arbitrage `match_no_referee`) —
 * décision de l'utilisateur du 2026-10-27 :
 *
 * - un match **planifié** (heure posée) : une alerte par match, réservée par
 *   appariement (`NO_REFEREE:<appariement>`), comme avant ;
 * - des matchs **sans horaire** : une alerte par manche, qui liste ceux qui
 *   entrent en lancement ensemble ; chaque match y garde sa réservation par
 *   appariement (`queueRoundNoRefereeAlert`) — un match de la manche entré plus
 *   tard part dans une alerte de suite qui ne liste que lui.
 *
 * Une seule clé par appariement dans les deux cas : un match dont l'heure est
 * posée ou retirée n'est pas signalé deux fois.
 */
export async function queueNoRefereeAlerts(
  connection: PoolConnection,
  candidates: readonly NoRefereeCandidate[],
): Promise<void> {
  const fresh = await withoutReservedAlerts(connection, candidates);
  const { perMatch, perRound } = groupNoRefereeAlerts(fresh);
  for (const match of perMatch) {
    await queueRefereeAlert(connection, { kind: "match_no_referee", matchId: match.matchId, pairing: match.pairing });
  }
  for (const round of perRound) await queueRoundNoRefereeAlert(connection, round.matches);
}

/**
 * Écarte, en **une** lecture, les candidats dont l'alerte est déjà réservée :
 * un match resté en lancement sans décision est revu à chaque passe de
 * l'entretien, et sa réservation ne se relit plus match par match. Simple
 * filtre : la réservation elle-même (`claimRefereeAlert`) tranche toujours une
 * course entre deux passes.
 */
async function withoutReservedAlerts(
  connection: PoolConnection,
  candidates: readonly NoRefereeCandidate[],
): Promise<NoRefereeCandidate[]> {
  if (candidates.length === 0) return [];
  const ids = [...new Set(candidates.map((candidate) => candidate.matchId))];
  let rows: (RowDataPacket & { match_id: number; alert_key: string })[];
  try {
    [rows] = await connection.execute<(RowDataPacket & { match_id: number; alert_key: string })[]>(
      `SELECT match_id, alert_key FROM bg_referee_alerts WHERE match_id IN (${sqlPlaceholders(ids.length)})`,
      ids,
    );
  } catch (error) {
    // Comme la réservation (`queueRefereeAlert`) : table absente ou verrou
    // dépassé ne défont pas le geste de l'appelant — la réservation tranche.
    if (isTransactionAborted(error)) throw error;
    return [...candidates];
  }
  const reserved = new Set(rows.map((row) => `${Number(row.match_id)}:${row.alert_key}`));
  return candidates.filter((candidate) => !reserved.has(`${candidate.matchId}:${noRefereeAlertKey(candidate.pairing)}`));
}

/**
 * Le match a-t-il atteint son lancement (heure passée ou absente, pas encore
 * lancé) ? Jugé phase de lancement **allumée**, quelle que soit l'option du
 * tournoi : c'est le moment où un tournoi sans lancement part d'office.
 */
function enteredLaunch(row: LaunchMatchBaseRow, now: number): boolean {
  return matchLaunchPhase({ ...toLaunchInput(row), launchPhase: true }, now) === "LOBBY";
}

/**
 * Entretien du lancement d'un tournoi en cours, appelé par la synchronisation
 * passive (`syncTournamentState`) dans **sa** transaction :
 *
 * - pose `lobby_opened_at` sur les matchs qui viennent d'entrer en lancement
 *   (c'est l'origine du délai de lancement d'office) ;
 * - lance ceux dont toutes les parties sont prêtes — deux fantômes le sont
 *   d'office, et personne ne cliquerait pour elles ;
 * - lance d'office ceux dont le délai est écoulé ;
 * - sur un tournoi **sans phase de lancement** (`match_launch_phase = 0`),
 *   lance aussitôt tout match qui atteint son heure (ou jouable sans heure).
 *
 * La phase est décidée en mémoire par le module pur, jamais réécrite en SQL :
 * la requête ne fait que réduire les candidats.
 *
 * @returns le nombre de matchs modifiés.
 */
export async function maintainMatchLaunches(
  connection: PoolConnection,
  tournamentId: number,
): Promise<number> {
  const [rows] = await connection.execute<LaunchMatchBaseRow[]>(
    `SELECT ${LAUNCH_MATCH_COLUMNS} ${LAUNCH_MATCH_FROM}
     WHERE m.tournament_id = ? AND m.status = 'READY'
       AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
       -- Un match à planifier n'a rien à entretenir (\`TO_PLAN\`) : l'écarter ici
       -- évite de le relire, puis de l'écarter en mémoire, à chaque passe.
       AND (m.start_at IS NOT NULL OR t.referee_scheduling = 0)
       AND (m.launched_at IS NULL
            OR NOT (m.launch_pairing <=> CONCAT(m.team1_id, ':', m.team2_id)))
     ORDER BY m.id`,
    [tournamentId],
  );
  const now = Date.now();
  let changed = 0;
  const undecided: NoRefereeCandidate[] = [];
  for (const candidate of rows) {
    // Les candidats sont parcourus par identifiant croissant (`ORDER BY`) : deux
    // entretiens du même tournoi — balayage passif et relève de la modale —
    // prennent ainsi leurs verrous dans le même ordre, sans interblocage.
    //
    // Premier tri sur la lecture ordinaire, puis **relecture sous verrou**
    // avant toute écriture : un « Prêt » validé entre les deux serait sinon
    // effacé par la remise à zéro d'un appariement lu périmé, ou un lancement
    // décidé sur un « Prêt » tout juste retiré.
    //
    // La phase est jugée **comme si le lancement était allumé** : sur un
    // tournoi qui l'a éteint, le match que la règle dit déjà « lancé » n'a pas
    // encore son `launched_at` — c'est ici qu'il le reçoit, à la première
    // passe, comme un lancement d'office sans délai. Diffusions, annonces et
    // notifications, qui lisent `launched_at`, partent ainsi à l'identique.
    if (!enteredLaunch(candidate, now)) continue;
    const row = await lockLaunchMatch(connection, Number(candidate.id), true);
    if (row?.status !== "READY" || !enteredLaunch(row, now)) continue;
    const stale = row.launch_pairing !== launchPairingKey(nullableId(row.team1_id), nullableId(row.team2_id));
    await adoptCurrentPairing(connection, row);
    // Ni le décompte des « Prêt » ni le lancement (qui rend publics le pseudo
    // et le lien du stream) ne comptent un caster devenu inéligible.
    // Un retrait change ce que voient les lecteurs : il compte comme un
    // changement à publier, même sans lancement.
    const released = await releaseIneligibleCasters(connection, row, true);
    const undecidedMatch = undecidedCandidate(row);
    if (undecidedMatch) undecided.push(undecidedMatch);
    const launch =
      Number(row.match_launch_phase ?? 0) !== 1 ||
      allPartiesReady(rowReadiness(row)) ||
      isAutoLaunchDue(toIso(row.lobby_opened_at), now);
    if (launch) {
      await connection.execute(
        `UPDATE bg_matches
         SET launched_at = NOW(), lobby_opened_at = COALESCE(lobby_opened_at, NOW())
         WHERE id = ? AND launched_at IS NULL`,
        [row.id],
      );
      changed += 1;
    } else if (row.lobby_opened_at === null) {
      await connection.execute(
        `UPDATE bg_matches SET lobby_opened_at = NOW() WHERE id = ? AND lobby_opened_at IS NULL`,
        [row.id],
      );
      changed += 1;
    } else if (stale || released) {
      changed += 1;
    }
  }
  await queueNoRefereeAlerts(connection, undecided);
  return changed;
}

/*
 * ── Arbitre désigné, autogestion, première carte ───────────────────────────
 * `docs/features/MATCH_REFEREE.md`. Toutes les écritures passent par le verrou
 * du match (`lockLaunchMatch`), comme celles des casters ; les annonces
 * (journal du staff, avis à l'arbitre retiré) partent après le commit.
 */

/** Refus communs à toute désignation : match absent, joué, ou exemption. */
function assertRefereeable(row: LaunchMatchRow | null): asserts row is LaunchMatchRow {
  assertOpenMatch(row ?? undefined);
}

/**
 * Refus communs aux gestes du staff sur un match (désignation, première carte) :
 * match absent, joué, ou exemption — qui n'a ni lancement ni carte.
 */
function assertOpenMatch(row: { status: string; is_bye: number } | undefined): void {
  if (!row) throw new Error("MATCH_NOT_FOUND");
  if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
  if (Number(row.is_bye) === 1) throw new Error("MATCH_NOT_LAUNCHABLE");
}

/**
 * Pose `refereeId` comme arbitre du match verrouillé : sa condition relue en
 * base (rôles compris, jamais ceux d'une session), le match qu'il joue refusé.
 * Éteint l'autogestion et remet son « Prêt » à zéro — sauf pour un caster du
 * match déjà prêt : un seul « Prêt » vaut pour les deux (`writeCasterReady`),
 * sa modale le montre prêt, le lancement ne doit pas l'attendre une seconde fois.
 */
async function writeReferee(connection: PoolConnection, row: LaunchMatchRow, refereeId: number): Promise<void> {
  // Lecture verrouillée : une suppression du compte en cours (verrou exclusif
  // sur sa ligne) est attendue puis lue, sans quoi l'arbitre désigné serait le
  // compte anonymisé, sur un match que son retrait n'avait pas vu.
  const block = await loadRefereeEligibility(connection, refereeId, row.tournament_game, true);
  if (block) throw new Error(block);
  // Opposition retenue : plus aucun arbitrage. Lecture verrouillée (partagée)
  // sur la ligne du compte : retenir l'opposition l'écrit en exclusif, donc ou
  // bien elle attend que ce geste soit validé et son balayage le voit, ou bien
  // ce geste attend qu'elle le soit et la lit (`referee-objection.ts`).
  if (await refereeObjectionUpheld(connection, refereeId, true)) throw new Error("REFEREE_OBJECTION");
  if (await resolveTeamParty(connection, row, refereeId)) throw new Error("REFEREE_IS_PLAYER");
  const casterReadyAt = row.casters.find((caster) => caster.userId === refereeId)?.readyAt ?? null;
  await connection.execute(
    `UPDATE bg_matches SET referee_user_id = ?, referee_ready_at = ?, self_managed = 0 WHERE id = ?`,
    [refereeId, casterReadyAt, row.id],
  );
}

/**
 * L'avis à l'arbitre qu'un autre reprend : le motif lu par le verrou, dans
 * l'ordre de `releaseIneligibleReferee` — une opposition retenue (motif
 * `OBJECTION` à l'arbitre, ligne du match au motif générique `INELIGIBLE`), puis la condition d'arbitrage, puis
 * l'équipe rejointe.
 */
function takenOverChange(row: LaunchMatchRow, matchId: number, refereeId: number): RefereeChange {
  if (row.refereeStanding?.objection) return { kind: "OBJECTION_RELEASED", matchId, refereeId, takenOver: true };
  const reason = row.refereeStanding?.block === null && row.refereeStanding.plays === true ? "JOINED_TEAM" : "INELIGIBLE";
  return { kind: "AUTO_RELEASED", matchId, refereeId, reason };
}

/**
 * « Je prends ce match » : le lecteur devient l'arbitre désigné. Un match qui
 * a déjà un arbitre éligible est refusé ; celui d'un arbitre devenu
 * inéligible est repris (l'ancien est prévenu, retrait d'office).
 *
 * @throws `NOT_REFEREE` | `REFEREE_IDENTITY_REQUIRED` | `REFEREE_OBJECTION`
 *   | `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE`
 *   | `REFEREE_IS_PLAYER` | `MATCH_ALREADY_REFEREED`
 */
export async function takeMatchReferee(matchId: number, userId: number): Promise<void> {
  const tournamentId = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockLaunchMatch(connection, matchId);
      assertRefereeable(row);
      const current = nullableId(row.referee_user_id);
      if (current === userId) {
        if (await refereeObjectionUpheld(connection, userId, true)) throw new Error("REFEREE_OBJECTION");
        return null;
      }
      if (current !== null && row.refereeEligible) throw new Error("MATCH_ALREADY_REFEREED");
      await writeReferee(connection, row, userId);
      if (current !== null) queueRefereeChange(connection, takenOverChange(row, matchId, current));
      queueRefereeChange(connection, { kind: "TAKEN", matchId });
      return Number(row.tournament_id);
    }),
  );
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

/**
 * Le retrait lui-même, commun aux trois chemins (volontaire ou staff, retrait
 * d'office, opposition retenue) : l'arbitre et son « Prêt » remis à `NULL` sur
 * le match verrouillé, puis, tournoi en cours, le départ d'un match qui
 * n'attendait plus que lui. `undecided` reçoit les matchs partis sans
 * arbitre (comme `launchIfAllReady`).
 */
async function clearMatchReferee(
  connection: PoolConnection,
  row: Pick<LaunchMatchBaseRow, "tournament_state">,
  matchId: number,
  undecided?: NoRefereeCandidate[],
): Promise<void> {
  await connection.execute(`UPDATE bg_matches SET referee_user_id = NULL, referee_ready_at = NULL WHERE id = ?`, [matchId]);
  if (row.tournament_state === "RUNNING") {
    await launchIfAllReady(connection, matchId, false, undefined, undecided);
  }
}

/**
 * Retire l'arbitre désigné : le sien pour l'arbitre lui-même, n'importe lequel
 * pour le staff (`canManage`, permission `tournaments`). Sans arbitre, rien ne
 * change. Si toutes les autres parties étaient prêtes, le match part.
 *
 * Un match joué ou exempt garde son arbitre : l'histoire ne se réécrit pas.
 *
 * `expected` (staff) : l'arbitre que la fenêtre montrait ; s'il a changé
 * depuis, rien n'est retiré (`REFEREE_CHANGED`).
 *
 * @throws `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE`
 *   | `NOT_MATCH_REFEREE` | `REFEREE_CHANGED`
 */
export async function releaseMatchReferee(
  matchId: number,
  userId: number,
  canManage: boolean,
  expected?: number | null,
): Promise<void> {
  const tournamentId = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockLaunchMatch(connection, matchId);
      assertRefereeable(row);
      const current = nullableId(row.referee_user_id);
      if (current !== userId && !canManage) throw new Error("NOT_MATCH_REFEREE");
      assertExpectedReferee(current, expected);
      if (current === null) return null;
      await clearMatchReferee(connection, row, matchId);
      queueRefereeChange(connection, { kind: "RELEASED", matchId, refereeId: current, byStaff: current !== userId });
      return Number(row.tournament_id);
    }),
  );
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

/**
 * La fenêtre du staff n'est relue qu'à l'ouverture et après ses propres gestes :
 * un geste qui dit quel arbitre il croyait remplacer (`expected`, `null` pour
 * aucun) est refusé si un autre membre du staff l'a changé entre-temps, sans
 * quoi il remplacerait sans le savoir l'arbitre tout juste désigné.
 * `undefined` : pas de contrôle (appel sans fenêtre).
 */
function assertExpectedReferee(current: number | null, expected: number | null | undefined): void {
  if (expected !== undefined && expected !== current) throw new Error("REFEREE_CHANGED");
}

/**
 * Le staff désigne l'arbitre du match (`refereeId`), en remplace un, ou le
 * retire (`null`). Désigner éteint l'autogestion ; l'arbitre remplacé est
 * prévenu — sauf s'il est l'auteur du geste (`staffUserId`).
 *
 * @throws `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE`
 *   | `NOT_REFEREE` | `REFEREE_IDENTITY_REQUIRED` | `REFEREE_OBJECTION` | `REFEREE_IS_PLAYER`
 *   | `REFEREE_CHANGED`
 */
export async function assignMatchReferee(
  matchId: number,
  staffUserId: number,
  refereeId: number | null,
  expected?: number | null,
): Promise<void> {
  if (refereeId === null) {
    await releaseMatchReferee(matchId, staffUserId, true, expected);
    return;
  }
  const tournamentId = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockLaunchMatch(connection, matchId);
      assertRefereeable(row);
      const current = nullableId(row.referee_user_id);
      if (current === refereeId) {
        if (await refereeObjectionUpheld(connection, refereeId, true)) throw new Error("REFEREE_OBJECTION");
        return null;
      }
      assertExpectedReferee(current, expected);
      await writeReferee(connection, row, refereeId);
      queueRefereeChange(connection, { kind: "ASSIGNED", matchId, replacedRefereeId: current, actorId: staffUserId });
      return Number(row.tournament_id);
    }),
  );
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

/** Ce que l'autogestion lit du match verrouillé. */
type SelfManagedRow = Pick<LaunchMatchBaseRow, "id" | "self_managed" | "referee_user_id" | "tournament_state">;

/**
 * Autogestion du match verrouillé : l'allumer retire l'arbitre (rendu à
 * l'appelant pour qu'il le prévienne), l'éteindre ne fait que l'éteindre.
 * Rend `undefined` quand rien ne change. `snapshotBeforeLock` : comme pour
 * `launchIfAllReady`, que l'appelant a lu avant le verrou du match.
 */
async function writeSelfManaged(
  connection: PoolConnection,
  row: SelfManagedRow,
  enabled: boolean,
  snapshotBeforeLock = false,
): Promise<{ replacedRefereeId: number | null } | undefined> {
  if ((Number(row.self_managed ?? 0) === 1) === enabled) return undefined;
  const replacedRefereeId = enabled ? nullableId(row.referee_user_id) : null;
  await connection.execute(
    enabled
      ? `UPDATE bg_matches SET self_managed = 1, referee_user_id = NULL, referee_ready_at = NULL WHERE id = ?`
      : `UPDATE bg_matches SET self_managed = 0 WHERE id = ?`,
    [row.id],
  );
  if (enabled && replacedRefereeId !== null && row.tournament_state === "RUNNING") {
    await launchIfAllReady(connection, Number(row.id), snapshotBeforeLock);
  }
  return { replacedRefereeId };
}

/**
 * Le staff passe un match en autogestion, ou l'en sort. Jamais d'office : sans
 * arbitre ni autogestion, le staff est seulement averti au lancement.
 * `actorId` : l'auteur du geste — l'arbitre qui s'écarte lui-même n'est pas prévenu.
 *
 * @throws `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE`
 */
export async function setMatchSelfManaged(matchId: number, enabled: boolean, actorId?: number): Promise<void> {
  const tournamentId = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockLaunchMatch(connection, matchId);
      assertRefereeable(row);
      const written = await writeSelfManaged(connection, row, enabled);
      if (!written) return null;
      queueRefereeChange(connection, {
        kind: "SELF_MANAGED",
        matchId,
        enabled,
        replacedRefereeId: written.replacedRefereeId,
        actorId,
      });
      return Number(row.tournament_id);
    }),
  );
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

/** Une manche du plateau : phase, numéro, et tableau (tous si `null`). */
export type RoundSelector = { phaseId: number; roundNumber: number; bracket: string | null };

/**
 * Autogestion de toute une manche, d'un geste. Le tournoi est verrouillé en
 * **première instruction** (une lecture ordinaire avant les verrous figeait
 * l'instantané `REPEATABLE READ` de la transaction), puis les matchs encore à
 * jouer de la manche (exemptions exclues) en **une** lecture verrouillante,
 * par identifiant croissant — l'ordre de l'entretien —, réduite aux colonnes
 * que l'autogestion lit ; chacun est écrit comme par `setMatchSelfManaged`.
 * Une seule ligne au journal pour la manche ; chaque arbitre retiré est
 * prévenu — sauf l'auteur du geste (`actorId`) —, les avis l'un après l'autre.
 *
 * @returns le nombre de matchs changés.
 * @throws `TOURNAMENT_NOT_FOUND`
 */
export async function setRoundSelfManaged(
  tournamentId: number,
  round: RoundSelector,
  enabled: boolean,
  actorId?: number,
): Promise<number> {
  const changed = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      // Le tournoi d'abord, comme la première carte (`setMatchFirstMap`).
      await lockTournamentRow(connection, tournamentId);
      const [tournament] = await connection.execute<(RowDataPacket & { state: string })[]>(
        `SELECT state FROM bg_tournaments WHERE id = ?`,
        [tournamentId],
      );
      if (tournament.length === 0) throw new Error("TOURNAMENT_NOT_FOUND");
      const tournamentState = String(tournament[0].state);
      const rows = await lockRoundMatches(connection, tournamentId, round);
      const written: { matchId: number; bracket: string; replacedRefereeId: number | null }[] = [];
      for (const row of rows) {
        const result = await writeSelfManaged(connection, { ...row, tournament_state: tournamentState }, enabled, true);
        if (result) {
          written.push({ matchId: Number(row.id), bracket: String(row.bracket), replacedRefereeId: result.replacedRefereeId });
        }
      }
      return written;
    }),
  );
  if (changed.length === 0) return 0;
  publishMatchUpdatedEvent(tournamentId);
  void announceRoundSelfManagement(
    changed[0].matchId,
    enabled,
    changed.length,
    changed.some((entry) => entry.replacedRefereeId !== null),
    new Set(changed.map((entry) => entry.bracket)).size > 1,
  );
  const notices: RefereeChange[] = changed.flatMap((entry) =>
    entry.replacedRefereeId === null
      ? []
      : [{ kind: "SELF_MANAGED", matchId: entry.matchId, enabled, replacedRefereeId: entry.replacedRefereeId, actorId }],
  );
  announceRefereeChanges(notices, { log: false });
  return changed.length;
}

type RoundMatchRow = RowDataPacket & {
  id: number;
  bracket: string;
  self_managed: number | null;
  referee_user_id: number | null;
  status: string;
  is_bye: number;
};

/**
 * Matchs à jouer de la manche, verrouillés **par clé primaire** : leurs
 * identifiants sont lus d'abord sans verrou, puis seules ces lignes sont
 * verrouillées, en une requête sans jointure (MariaDB). Un verrou posé par le
 * filtre de la manche aurait pris aussi les intervalles de l'index du tournoi
 * — les « Prêt » des autres manches attendaient le geste. Statut relu sous
 * verrou.
 */
async function lockRoundMatches(
  connection: PoolConnection,
  tournamentId: number,
  round: RoundSelector,
): Promise<RoundMatchRow[]> {
  const bracketFilter = round.bracket === null ? "" : "AND bracket = ?";
  const [candidates] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_matches
      WHERE tournament_id = ? AND phase_id = ? AND round_number = ? ${bracketFilter}
        AND status <> 'COMPLETED' AND is_bye = 0`,
    round.bracket === null
      ? [tournamentId, round.phaseId, round.roundNumber]
      : [tournamentId, round.phaseId, round.roundNumber, round.bracket],
  );
  if (candidates.length === 0) return [];
  const ids = candidates.map((row) => Number(row.id));
  const [rows] = await connection.execute<RoundMatchRow[]>(
    `SELECT id, bracket, self_managed, referee_user_id, status, is_bye FROM bg_matches
      WHERE id IN (${sqlPlaceholders(ids.length)})
      ORDER BY id
      FOR UPDATE`,
    ids,
  );
  return rows.filter((row) => row.status !== "COMPLETED" && Number(row.is_bye) === 0);
}

/**
 * La ligne du journal d'une manche passée (ou sortie) en autogestion. Ne lève
 * jamais. `mixedBrackets` : plusieurs tableaux changés (tous les tableaux de la
 * manche) — la ligne dit « Manche N » sans nommer le tableau du premier match.
 */
async function announceRoundSelfManagement(
  sampleMatchId: number,
  enabled: boolean,
  count: number,
  removedReferee: boolean,
  mixedBrackets: boolean,
): Promise<void> {
  try {
    const row = await loadMatchLogRow(sampleMatchId);
    if (!row) return;
    const match = matchLogSubject(row);
    sendBotLog(
      formatRoundSelfManagementLog({
        tournament: match.tournament,
        roundLabel: matchRoundLabel(mixedBrackets ? "" : match.bracket, match.roundNumber, match.swiss),
        enabled,
        count,
      }),
      // Un arbitre écarté par le geste : retrait, donc alerte.
      { tournamentId: match.tournament.id, category: removedReferee ? "staff-removal" : "referees" },
    );
  } catch (error) {
    console.error("[referee] autogestion de manche non annoncée", error);
  }
}

type FirstMapRow = RowDataPacket & {
  tournament_id: number;
  status: MatchStatus;
  is_bye: number;
  first_map: string | null;
  phase_id: number;
  bracket: string;
  round_number: number;
};

const FIRST_MAP_SELECT = `SELECT tournament_id, status, is_bye, first_map, phase_id, bracket, round_number FROM bg_matches WHERE id = ? LIMIT 1`;

/** Refus de la première carte : match absent, joué, ou exemption. */
function assertFirstMapSettable(row: FirstMapRow | undefined): asserts row is FirstMapRow {
  assertOpenMatch(row);
}

/**
 * Première carte du match, saisie par le staff ; `null` (ou vide) la retire.
 *
 * **Échelle** (`ROUND_MAPS.md`) : dès que la manche du match porte des cartes
 * réglées au tour, la saisie par match est fermée (`ROUND_MAPS_SET`) — une carte
 * de pool se choisit par `pickMatchMap`, et réinitialiser la manche rouvre la
 * saisie. Le tournoi est verrouillé en première instruction (`lockTournamentRow`,
 * comme `setRoundMaps`) : la saisie ne passe pas à côté d'un réglage posé au même
 * instant. Le match est lu avant, hors transaction (lecture autonome), pour
 * connaître son tournoi ; tout est relu sous verrou.
 *
 * Une exemption n'a pas de carte : refusée (`MATCH_NOT_LAUNCHABLE`) comme par
 * tout autre geste d'arbitrage (`assertRefereeable`).
 *
 * @throws `INVALID_FIRST_MAP` | `ROUND_MAPS_SET` | `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED`
 *   | `MATCH_NOT_LAUNCHABLE`
 */
export async function setMatchFirstMap(matchId: number, rawMap: unknown): Promise<void> {
  const typed = normalizeFirstMap(rawMap);
  const pre = await withConnection(async (connection) => {
    const [rows] = await connection.execute<FirstMapRow[]>(FIRST_MAP_SELECT, [matchId]);
    return rows[0];
  });
  assertFirstMapSettable(pre);
  const ownerId = Number(pre.tournament_id);
  // Rejouée sur interblocage : le verrou tournoi puis match croise les
  // écritures d'arbitrage qui prennent le match puis le tournoi.
  const tournamentId = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      await lockTournamentRow(connection, ownerId);
      const [rows] = await connection.execute<FirstMapRow[]>(`${FIRST_MAP_SELECT} FOR UPDATE`, [matchId]);
      const row = rows[0];
      assertFirstMapSettable(row);
      const slots = await loadRoundSlots(connection, ownerId, {
        phaseId: Number(row.phase_id),
        bracket: String(row.bracket),
        roundNumber: Number(row.round_number),
      });
      if (slots.length > 0) throw new Error("ROUND_MAPS_SET");
      if ((row.first_map ?? null) === typed) return null;
      await connection.execute(`UPDATE bg_matches SET first_map = ? WHERE id = ?`, [typed, matchId]);
      queueRefereeChange(connection, { kind: "FIRST_MAP", matchId, set: typed !== null });
      return ownerId;
    }),
  );
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

/**
 * Retire d'office l'arbitre désigné qui ne remplit plus la condition
 * d'arbitrage, ou qui joue désormais le match. Tout est relu sous verrou ; un
 * match lancé ou joué garde son arbitre (seulement tu tant qu'il est
 * inéligible). Comme au retrait volontaire, un match qui n'attendait plus que
 * lui part.
 *
 * @returns vrai si l'arbitre a été retiré.
 */
export async function releaseIneligibleReferee(
  matchId: number,
  refereeId: number,
  undecided?: NoRefereeCandidate[],
): Promise<boolean> {
  let tournamentId: number | null = null;
  let change: RefereeChange | null = null;
  // Matchs partis sans arbitre dans **cette** tentative : remis à l'appelant
  // seulement une fois la transaction validée — un lancement défait (tentative
  // rejouée, échec) ne doit pas être signalé.
  let launched: NoRefereeCandidate[] = [];
  await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      // Une tentative rejouée après un interblocage repart de zéro.
      tournamentId = null;
      change = null;
      launched = [];
      const row = await lockLaunchMatch(connection, matchId);
      if (!row || nullableId(row.referee_user_id) !== refereeId || row.status === "COMPLETED") return;
      const phase = matchLaunchPhase({ ...toLaunchInput(row), launchPhase: true }, Date.now());
      if (phase !== "TO_PLAN" && phase !== "SCHEDULED" && phase !== "LOBBY") return;
      // `lockLaunchMatch` compte déjà inéligible un arbitre qui joue le match
      // avant le départ : rien à faire tant qu'il compte. Le motif dit
      // d'abord les conditions d'arbitrage, l'équipe ensuite.
      if (row.refereeEligible) return;
      // Le motif réel : opposition retenue, équipe rejointe, ou condition perdue.
      change = takenOverChange(row, matchId, refereeId);
      await clearMatchReferee(connection, row, matchId, undecided ? launched : undefined);
      tournamentId = Number(row.tournament_id);
    }),
  );
  undecided?.push(...launched);
  if (tournamentId === null || change === null) return false;
  publishMatchUpdatedEvent(tournamentId);
  announceRefereeChange(change);
  return true;
}

/**
 * Retire de ce match l'arbitre dont l'opposition vient d'être retenue
 * (`referee-objection.ts`) — **quel que soit l'état du match tant qu'il n'est
 * pas joué**, lancé compris, contrairement au retrait d'office. Relu sous le
 * verrou du match ; s'il n'en est plus l'arbitre ou que le match est joué,
 * rien ne change, de même si l'opposition a été levée entre-temps. Un match qui n'attendait plus que lui part ; l'arbitre est
 * prévenu (motif `OBJECTION`), le journal dit « retiré par le staff ».
 *
 * @returns vrai si l'arbitre a été retiré.
 */
export async function releaseObjectingReferee(
  matchId: number,
  refereeId: number,
  undecided?: NoRefereeCandidate[],
): Promise<boolean> {
  // Comme `releaseIneligibleReferee` : remis à l'appelant après validation seulement.
  let launched: NoRefereeCandidate[] = [];
  const tournamentId = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      launched = [];
      const row = await lockLaunchMatch(connection, matchId);
      if (!row || nullableId(row.referee_user_id) !== refereeId || row.status === "COMPLETED") return null;
      // Relue sous le verrou du match (même ordre que `writeReferee` : match
      // puis compte) : levée entre-temps, l'opposition ne retire plus rien.
      if (!(await refereeObjectionUpheld(connection, refereeId, true))) return null;
      await clearMatchReferee(connection, row, matchId, undecided ? launched : undefined);
      queueRefereeChange(connection, { kind: "OBJECTION_RELEASED", matchId, refereeId });
      return Number(row.tournament_id);
    }),
  );
  undecided?.push(...launched);
  if (tournamentId === null) return false;
  publishMatchUpdatedEvent(tournamentId);
  return true;
}
