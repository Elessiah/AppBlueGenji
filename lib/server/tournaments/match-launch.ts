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
import { parseStreamUrlInput, shownStreams } from "@/lib/shared/live-streams";
import {
  groupNoRefereeAlerts,
  normalizeFirstMap,
  refereeDecision,
  type NoRefereeCandidate,
} from "@/lib/shared/match-referee";
import { formatRoundSelfManagementLog } from "@/lib/shared/bot-logs";
import { matchRoundLabel } from "@/lib/shared/discord-notifications";
import { sendBotLog } from "@/lib/server/bot-integration";
import type { MatchStatus, TeamRole } from "@/lib/shared/types";
import {
  casterIdentityOf,
  loadCastEligibility,
  loadEligibleCasterIds,
  loadRefereeEligibility,
  refereeObjectionUpheld,
  type CasterIdentityRow,
} from "./cast-eligibility";
import { announceCastChange, queueCastChange } from "./cast-notices";
import {
  lockMatchCasters,
  lockMatchStreams,
  pruneMatchStreams,
  type MatchCasterLink,
  type MatchStreamRow,
} from "./match-casters";
import { retryOnDeadlock } from "./deadlock-retry";
import { lockTournamentRow } from "./registration";
import { announceRefereeChange, queueRefereeChange } from "./referee-notices";
import { loadMatchLogRow, matchLogSubject } from "./match-log-subject";
import { queueRefereeAlert, queueRoundNoRefereeAlert } from "./bot-logs";
import { publishMatchUpdatedEvent } from "./notifications";
import { loadRoundSlots } from "./round-map-slots";
import { inTransaction } from "./transaction";

/** La ligne d'un match telle que le lancement la lit, sans ses casters. */
export type LaunchMatchBaseRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_state: string;
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
};

const LAUNCH_MATCH_COLUMNS = `
  m.id, m.tournament_id, t.state AS tournament_state, t.referee_scheduling, t.match_launch_phase,
  m.status, m.is_bye,
  m.team1_id, m.team2_id, t1.is_ghost AS team1_is_ghost, t2.is_ghost AS team2_is_ghost,
  m.start_at, m.lobby_opened_at, m.launch_pairing, m.launched_at, m.team1_ready_at,
  m.team2_ready_at, m.host_team_id, m.referee_user_id, m.referee_ready_at, m.self_managed,
  m.phase_id, m.bracket, m.round_number`;

const LAUNCH_MATCH_FROM = `
  FROM bg_matches m
  JOIN bg_tournaments t ON t.id = m.tournament_id
  LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
  LEFT JOIN bg_teams t2 ON t2.id = m.team2_id`;

function nullableId(value: number | null): number | null {
  return value === null ? null : Number(value);
}

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
const READY_AT_COLUMNS: Record<Exclude<LaunchViewerRole, "CASTER">, string> = {
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
  row.launch_pairing = key;
  row.lobby_opened_at = null;
  row.launched_at = null;
  row.team1_ready_at = null;
  row.team2_ready_at = null;
  row.referee_ready_at = null;
  // L'arbitre désigné qui joue l'appariement qui arrive ne peut plus l'arbitrer.
  if (row.referee_user_id !== null && (await resolveTeamParty(connection, row, Number(row.referee_user_id)))) {
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
  await pruneMatchStreams(connection, Number(row.id), { casters: row.casters });
  for (const casterId of playing) {
    // Annoncé comme tout retrait d'office (journal du staff, avis au caster),
    // après le commit de la transaction appelante : `inTransaction` ici,
    // `flushBotLogs` pour l'entretien.
    queueCastChange(connection, { kind: "AUTO_RELEASED", matchId: Number(row.id), casterId, reason: "JOINED_TEAM" });
  }
}

/** Colonnes propres à la ligne du match, relues sous verrou par `lockLaunchMatch`. */
const LAUNCH_MATCH_OWN_COLUMNS = `
  m.id, m.tournament_id, m.status, m.is_bye, m.team1_id, m.team2_id,
  m.start_at, m.lobby_opened_at, m.launch_pairing, m.launched_at, m.team1_ready_at,
  m.team2_ready_at, m.host_team_id, m.referee_user_id, m.referee_ready_at, m.self_managed,
  m.phase_id, m.bracket, m.round_number`;

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
      referee_scheduling: number | null;
      match_launch_phase: number | null;
      team1_is_ghost: number | null;
      team2_is_ghost: number | null;
    })[]
  >(
    `SELECT
       (SELECT state FROM bg_tournaments WHERE id = ?) AS tournament_state,
       (SELECT referee_scheduling FROM bg_tournaments WHERE id = ?) AS referee_scheduling,
       (SELECT match_launch_phase FROM bg_tournaments WHERE id = ?) AS match_launch_phase,
       (SELECT is_ghost FROM bg_teams WHERE id = ?) AS team1_is_ghost,
       (SELECT is_ghost FROM bg_teams WHERE id = ?) AS team2_is_ghost`,
    [
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
  // Avant le départ, un arbitre qui joue désormais le match (roster rejoint
  // sans changer d'appariement) ne compte plus : sinon le lancement attendrait
  // un « Prêt » d'arbitre qu'il ne peut plus donner (il clique en joueur).
  const refereeId = nullableId(base.referee_user_id);
  const refereeEligible =
    refereeId !== null &&
    (await loadRefereeEligibility(connection, refereeId)) === null &&
    // Une opposition retenue ferme l'arbitrage : un arbitre que le balayage
    // n'aurait pas retiré (échec en cours de route) ne compte plus, comme un
    // inéligible — le lancement ne l'attend pas, un autre peut prendre le match.
    !(await refereeObjectionUpheld(connection, refereeId)) &&
    (base.launched_at !== null || (await resolveTeamParty(connection, base, refereeId)) === null);
  const row: LaunchMatchRow = Object.assign(base, {
    casters: await lockMatchCasters(connection, matchId, !snapshotBeforeLock),
    refereeEligible,
  });
  row.tournament_state = tournamentState;
  row.referee_scheduling = context[0]?.referee_scheduling ?? 0;
  row.match_launch_phase = context[0]?.match_launch_phase ?? 0;
  row.team1_is_ghost = context[0]?.team1_is_ghost ?? null;
  row.team2_is_ghost = context[0]?.team2_is_ghost ?? null;
  return row;
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
    if ((await loadCastEligibility(connection, userId)) === null) return { role: "CASTER", canDeclareReady: true };
  }
  // L'arbitre désigné, tant qu'il remplit la condition d'arbitrage. Un arbitre
  // qui caste aussi lit en caster : un seul « Prêt » vaut pour les deux.
  if (match.refereeEligible && match.referee_user_id != null && Number(match.referee_user_id) === userId) {
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
    `SELECT team_id, roles_json FROM bg_team_members
     WHERE user_id = ? AND left_at IS NULL AND team_id IN (${placeholders})
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
 */
async function launchIfAllReady(connection: PoolConnection, matchId: number): Promise<boolean> {
  const row = await lockLaunchMatch(connection, matchId);
  if (!row) return false;
  await adoptCurrentPairing(connection, row);
  if (matchLaunchPhase(toLaunchInput(row), Date.now()) !== "LOBBY") return false;
  // Un caster devenu inéligible ne donnera plus son « Prêt » : il est retiré
  // avant le décompte, sinon le match l'attendrait jusqu'au lancement d'office.
  await releaseIneligibleCasters(connection, row);
  if (!allPartiesReady(rowReadiness(row))) return false;
  await connection.execute(`UPDATE bg_matches SET launched_at = NOW() WHERE id = ?`, [matchId]);
  return true;
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
  const alsoReferee = row.refereeEligible && Number(row.referee_user_id) === userId;
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
    }
    const launchedNow = ready ? await launchIfAllReady(connection, matchId) : false;
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
): Promise<CastBlock | null> {
  if (!hasLivePermission) return castBlockReason(false, { discordVerified: false, blizzardLinked: false });
  const identity = await withConnection((connection) => loadCasterIdentity(connection, userId));
  return castBlockReason(true, identity);
}

/**
 * Où un caster s'inscrit : **co-cast** d'un stream existant du match
 * (`streamId`, aucun lien de plus), ou stream **à part** (`liveUrl`, son propre
 * lien, facultatif — `null` : pas encore de lien public).
 */
export type CastTarget = { streamId: number } | { liveUrl: string | null };

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
  const settled = row.launched_at !== null;
  const holders = row.casters.filter((caster) => caster.streamId === stream.id).map((caster) => caster.userId);
  let held = false;
  if (!stream.staff && !settled && holders.length > 0) {
    held = (await loadEligibleCasterIds(connection, holders, true)).size > 0;
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
 */
async function releaseIneligibleCasters(connection: PoolConnection, row: LaunchMatchRow): Promise<void> {
  if (row.casters.length === 0 || row.launched_at !== null || row.status === "COMPLETED") return;
  const eligible = await loadEligibleCasterIds(connection, row.casters.map((caster) => caster.userId));
  const leaving = row.casters.filter((caster) => !eligible.has(caster.userId));
  if (leaving.length === 0) return;
  await connection.execute(
    `DELETE FROM bg_match_casters WHERE match_id = ? AND user_id IN (${leaving.map(() => "?").join(", ")})`,
    [row.id, ...leaving.map((caster) => caster.userId)],
  );
  row.casters = row.casters.filter((caster) => eligible.has(caster.userId));
  await pruneMatchStreams(connection, Number(row.id), { casters: row.casters });
  for (const caster of leaving) {
    queueCastChange(connection, {
      kind: "AUTO_RELEASED",
      matchId: Number(row.id),
      casterId: caster.userId,
      reason: "INELIGIBLE",
    });
  }
}

/**
 * Inscrit le lecteur comme caster du match, sans plafond : sur un stream
 * existant (co-cast) ou sur un stream qu'il ouvre (`target`).
 * `hasLivePermission` est la permission `live`, établie par la route. Un
 * caster déjà inscrit sur le match n'est pas réinscrit (rien ne change, pas
 * même son stream : il se retire d'abord pour en changer).
 *
 * @throws `NOT_CASTER` | `CASTER_IDENTITY_REQUIRED` | `MATCH_NOT_FOUND`
 *   | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE` | `CASTER_IS_PLAYER`
 *   | `STREAM_NOT_FOUND` | `INVALID_STREAM_URL`
 */
export async function claimMatchCast(
  matchId: number,
  userId: number,
  hasLivePermission: boolean,
  target?: CastTarget,
): Promise<void> {
  const castTarget: CastTarget = target ?? { liveUrl: null };
  // Le lien est jugé avant toute lecture : un refus ne coûte rien.
  const liveUrl = "liveUrl" in castTarget ? parseStreamUrlInput(castTarget.liveUrl) : null;
  // Deux inscriptions simultanées se croisent sur les verrous d'intervalle
  // d'InnoDB : l'interblocage se rejoue.
  const { tournamentId, claimed } = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      // Ligne du compte verrouillée en première instruction, avant le match —
      // l'ordre de la suppression de compte (compte, puis ses matchs).
      const block = castBlockReason(hasLivePermission, await loadCasterIdentity(connection, userId, true));
      if (block) throw new Error(block);

      const row = await lockLaunchMatch(connection, matchId);
      if (!row) throw new Error("MATCH_NOT_FOUND");
      if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
      if (Number(row.is_bye) === 1) throw new Error("MATCH_NOT_LAUNCHABLE");
      if (row.casters.some((caster) => caster.userId === userId)) {
        return { tournamentId: Number(row.tournament_id), claimed: false };
      }
      const party = await resolveMatchParty(connection, row, userId);
      if (party) throw new Error("CASTER_IS_PLAYER");

      let streamId: number;
      if ("streamId" in castTarget) {
        const streams = await lockMatchStreams(connection, matchId, true);
        const stream = streams.find((candidate) => candidate.id === castTarget.streamId);
        if (!stream || !(await streamShown(connection, row, stream))) throw new Error("STREAM_NOT_FOUND");
        streamId = castTarget.streamId;
      } else {
        // Le lien est rattaché à celui qui le fournit : son effacement de
        // compte le retire (`withdrawUserCasts`).
        const [created] = await connection.execute<ResultSetHeader>(
          `INSERT INTO bg_match_streams (match_id, live_url, link_user_id) VALUES (?, ?, ?)`,
          [matchId, liveUrl, liveUrl === null ? null : userId],
        );
        streamId = Number(created.insertId);
      }
      await connection.execute(
        `INSERT INTO bg_match_casters (match_id, user_id, stream_id, ready_at) VALUES (?, ?, ?, NULL)`,
        [matchId, userId, streamId],
      );
      return { tournamentId: Number(row.tournament_id), claimed: true };
    }),
  );
  // Une inscription change ce que montrent l'accueil et ses bandeaux (un
  // lien neuf, ou un co-caster éligible dont le stream jusque-là tu devient
  // visible) ; une inscription déjà acquise ne change rien.
  publishMatchUpdatedEvent(tournamentId, { landingLive: claimed });
  // Après le commit : journal du staff. Aucune place n'est reprise à personne.
  if (claimed) announceCastChange({ kind: "CLAIMED", matchId, replacedCasterId: null });
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
      await pruneMatchStreams(connection, matchId, {
        casters: row.casters.filter((caster) => caster.userId !== casterId),
      });
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
  await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
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
      if ((await loadCastEligibility(connection, casterId)) === null) {
        if ((await resolveTeamParty(connection, row, casterId)) === null) return;
        reason = "JOINED_TEAM";
      }

      await connection.execute(`DELETE FROM bg_match_casters WHERE match_id = ? AND user_id = ?`, [matchId, casterId]);
      await pruneMatchStreams(connection, matchId, {
        casters: row.casters.filter((caster) => caster.userId !== casterId),
      });
      if (row.tournament_state === "RUNNING") await launchIfAllReady(connection, matchId);
      tournamentId = Number(row.tournament_id);
    }),
  );
  if (tournamentId === null) return false;
  publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  announceCastChange({ kind: "AUTO_RELEASED", matchId, casterId, reason });
  return true;
}

/**
 * Désigne l'équipe qui héberge la partie ; `null` rend la main au défaut
 * (équipe 1). Aucune garde d'état : c'est une information d'organisation.
 *
 * @throws `MATCH_NOT_FOUND` | `INVALID_HOST_TEAM`
 */
export async function setMatchHost(matchId: number, teamId: number | null): Promise<void> {
  const tournamentId = await inTransaction(async (connection) => {
    const row = await lockLaunchMatch(connection, matchId);
    if (!row) throw new Error("MATCH_NOT_FOUND");
    if (
      teamId !== null &&
      teamId !== nullableId(row.team1_id) &&
      teamId !== nullableId(row.team2_id)
    ) {
      throw new Error("INVALID_HOST_TEAM");
    }
    await connection.execute(`UPDATE bg_matches SET host_team_id = ? WHERE id = ?`, [
      teamId,
      matchId,
    ]);
    return Number(row.tournament_id);
  });
  publishMatchUpdatedEvent(tournamentId);
}

/**
 * Le match entre-t-il en lancement **sans arbitre ni autogestion** ? Rend sa
 * candidature à l'alerte du staff, `null` s'il a une décision (ou pas encore
 * ses deux engagées). Rien d'autre : le match part comme avant, jamais
 * d'autogestion d'office (décision de l'utilisateur, 2026-10-26).
 */
function undecidedCandidate(row: LaunchMatchRow): NoRefereeCandidate | null {
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
  const { perMatch, perRound } = groupNoRefereeAlerts(candidates);
  for (const match of perMatch) {
    await queueRefereeAlert(connection, { kind: "match_no_referee", matchId: match.matchId, pairing: match.pairing });
  }
  const pairingOf = new Map(candidates.map((candidate) => [candidate.matchId, candidate.pairing]));
  for (const round of perRound) {
    await queueRoundNoRefereeAlert(
      connection,
      round.matchIds.map((matchId) => ({ matchId, pairing: pairingOf.get(matchId) ?? "" })),
    );
  }
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
    await releaseIneligibleCasters(connection, row);
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
    } else if (stale) {
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
  const block = await loadRefereeEligibility(connection, refereeId, true);
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
      if (current !== null) {
        queueRefereeChange(connection, { kind: "AUTO_RELEASED", matchId, refereeId: current, reason: "INELIGIBLE" });
      }
      queueRefereeChange(connection, { kind: "TAKEN", matchId });
      return Number(row.tournament_id);
    }),
  );
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

/**
 * Retire l'arbitre désigné : le sien pour l'arbitre lui-même, n'importe lequel
 * pour le staff (`canManage`, permission `tournaments`). Sans arbitre, rien ne
 * change. Si toutes les autres parties étaient prêtes, le match part.
 *
 * Un match joué ou exempt garde son arbitre : l'histoire ne se réécrit pas.
 *
 * @throws `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE`
 *   | `NOT_MATCH_REFEREE`
 */
export async function releaseMatchReferee(matchId: number, userId: number, canManage: boolean): Promise<void> {
  const tournamentId = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockLaunchMatch(connection, matchId);
      assertRefereeable(row);
      const current = nullableId(row.referee_user_id);
      if (current !== userId && !canManage) throw new Error("NOT_MATCH_REFEREE");
      if (current === null) return null;
      await connection.execute(`UPDATE bg_matches SET referee_user_id = NULL, referee_ready_at = NULL WHERE id = ?`, [
        matchId,
      ]);
      if (row.tournament_state === "RUNNING") await launchIfAllReady(connection, matchId);
      queueRefereeChange(connection, { kind: "RELEASED", matchId, refereeId: current, byStaff: current !== userId });
      return Number(row.tournament_id);
    }),
  );
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

/**
 * Le staff désigne l'arbitre du match (`refereeId`), en remplace un, ou le
 * retire (`null`). Désigner éteint l'autogestion ; l'arbitre remplacé est prévenu.
 *
 * @throws `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE`
 *   | `NOT_REFEREE` | `REFEREE_IDENTITY_REQUIRED` | `REFEREE_OBJECTION` | `REFEREE_IS_PLAYER`
 */
export async function assignMatchReferee(
  matchId: number,
  staffUserId: number,
  refereeId: number | null,
): Promise<void> {
  if (refereeId === null) {
    await releaseMatchReferee(matchId, staffUserId, true);
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
      await writeReferee(connection, row, refereeId);
      queueRefereeChange(connection, { kind: "ASSIGNED", matchId, replacedRefereeId: current });
      return Number(row.tournament_id);
    }),
  );
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

/**
 * Autogestion du match verrouillé : l'allumer retire l'arbitre (rendu à
 * l'appelant pour qu'il le prévienne), l'éteindre ne fait que l'éteindre.
 * Rend `undefined` quand rien ne change.
 */
async function writeSelfManaged(
  connection: PoolConnection,
  row: LaunchMatchRow,
  enabled: boolean,
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
    await launchIfAllReady(connection, Number(row.id));
  }
  return { replacedRefereeId };
}

/**
 * Le staff passe un match en autogestion, ou l'en sort. Jamais d'office : sans
 * arbitre ni autogestion, le staff est seulement averti au lancement.
 *
 * @throws `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE`
 */
export async function setMatchSelfManaged(matchId: number, enabled: boolean): Promise<void> {
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
      });
      return Number(row.tournament_id);
    }),
  );
  if (tournamentId !== null) publishMatchUpdatedEvent(tournamentId);
}

/** Une manche du plateau : phase, numéro, et tableau (tous si `null`). */
export type RoundSelector = { phaseId: number; roundNumber: number; bracket: string | null };

/**
 * Autogestion de toute une manche, d'un geste : chaque match encore à jouer
 * (exemptions exclues) est verrouillé par identifiant croissant — l'ordre de
 * l'entretien —, puis écrit comme par `setMatchSelfManaged`. Une seule ligne
 * au journal pour la manche ; chaque arbitre retiré est prévenu.
 *
 * @returns le nombre de matchs changés.
 * @throws `TOURNAMENT_NOT_FOUND`
 */
export async function setRoundSelfManaged(
  tournamentId: number,
  round: RoundSelector,
  enabled: boolean,
): Promise<number> {
  const changed = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const [tournament] = await connection.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM bg_tournaments WHERE id = ? LIMIT 1`,
        [tournamentId],
      );
      if (tournament.length === 0) throw new Error("TOURNAMENT_NOT_FOUND");
      const bracketFilter = round.bracket === null ? "" : "AND bracket = ?";
      const [candidates] = await connection.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM bg_matches
          WHERE tournament_id = ? AND phase_id = ? AND round_number = ? ${bracketFilter}
            AND status <> 'COMPLETED' AND is_bye = 0
          ORDER BY id`,
        round.bracket === null
          ? [tournamentId, round.phaseId, round.roundNumber]
          : [tournamentId, round.phaseId, round.roundNumber, round.bracket],
      );
      const written: { matchId: number; replacedRefereeId: number | null }[] = [];
      for (const candidate of candidates) {
        const row = await lockLaunchMatch(connection, Number(candidate.id), true);
        if (row?.status === "COMPLETED" || !row || Number(row.is_bye) === 1) continue;
        const result = await writeSelfManaged(connection, row, enabled);
        if (result) written.push({ matchId: Number(row.id), replacedRefereeId: result.replacedRefereeId });
      }
      return written;
    }),
  );
  if (changed.length === 0) return 0;
  publishMatchUpdatedEvent(tournamentId);
  void announceRoundSelfManagement(changed[0].matchId, enabled, changed.length);
  for (const entry of changed) {
    if (entry.replacedRefereeId === null) continue;
    announceRefereeChange(
      { kind: "SELF_MANAGED", matchId: entry.matchId, enabled, replacedRefereeId: entry.replacedRefereeId },
      { log: false },
    );
  }
  return changed.length;
}

/** La ligne du journal d'une manche passée (ou sortie) en autogestion. Ne lève jamais. */
async function announceRoundSelfManagement(sampleMatchId: number, enabled: boolean, count: number): Promise<void> {
  try {
    const row = await loadMatchLogRow(sampleMatchId);
    if (!row) return;
    const match = matchLogSubject(row);
    await sendBotLog(
      formatRoundSelfManagementLog({
        tournament: match.tournament,
        roundLabel: matchRoundLabel(match.bracket, match.roundNumber, match.swiss),
        enabled,
        count,
      }),
    );
  } catch (error) {
    console.error("[referee] autogestion de manche non annoncée", error);
  }
}

type FirstMapRow = RowDataPacket & {
  tournament_id: number;
  status: MatchStatus;
  first_map: string | null;
  phase_id: number;
  bracket: string;
  round_number: number;
};

const FIRST_MAP_SELECT = `SELECT tournament_id, status, first_map, phase_id, bracket, round_number FROM bg_matches WHERE id = ? LIMIT 1`;

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
 * @throws `INVALID_FIRST_MAP` | `ROUND_MAPS_SET` | `MATCH_NOT_FOUND` | `MATCH_ALREADY_COMPLETED`
 */
export async function setMatchFirstMap(matchId: number, rawMap: unknown): Promise<void> {
  const typed = normalizeFirstMap(rawMap);
  const pre = await withConnection(async (connection) => {
    const [rows] = await connection.execute<FirstMapRow[]>(FIRST_MAP_SELECT, [matchId]);
    return rows[0];
  });
  if (!pre) throw new Error("MATCH_NOT_FOUND");
  if (pre.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
  const ownerId = Number(pre.tournament_id);
  // Rejouée sur interblocage : le verrou tournoi puis match croise les
  // écritures d'arbitrage qui prennent le match puis le tournoi.
  const tournamentId = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      await lockTournamentRow(connection, ownerId);
      const [rows] = await connection.execute<FirstMapRow[]>(`${FIRST_MAP_SELECT} FOR UPDATE`, [matchId]);
      const row = rows[0];
      if (!row) throw new Error("MATCH_NOT_FOUND");
      if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
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
export async function releaseIneligibleReferee(matchId: number, refereeId: number): Promise<boolean> {
  let tournamentId: number | null = null;
  let reason: "INELIGIBLE" | "JOINED_TEAM" = "INELIGIBLE";
  await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      // Une tentative rejouée après un interblocage repart de zéro.
      tournamentId = null;
      reason = "INELIGIBLE";
      const row = await lockLaunchMatch(connection, matchId);
      if (!row || nullableId(row.referee_user_id) !== refereeId || row.status === "COMPLETED") return;
      const phase = matchLaunchPhase({ ...toLaunchInput(row), launchPhase: true }, Date.now());
      if (phase !== "TO_PLAN" && phase !== "SCHEDULED" && phase !== "LOBBY") return;
      // `lockLaunchMatch` compte déjà inéligible un arbitre qui joue le match
      // avant le départ : rien à faire tant qu'il compte. Le motif dit
      // d'abord les conditions d'arbitrage, l'équipe ensuite.
      if (row.refereeEligible) return;
      if ((await loadRefereeEligibility(connection, refereeId)) === null) reason = "JOINED_TEAM";
      await connection.execute(`UPDATE bg_matches SET referee_user_id = NULL, referee_ready_at = NULL WHERE id = ?`, [
        matchId,
      ]);
      if (row.tournament_state === "RUNNING") await launchIfAllReady(connection, matchId);
      tournamentId = Number(row.tournament_id);
    }),
  );
  if (tournamentId === null) return false;
  publishMatchUpdatedEvent(tournamentId);
  announceRefereeChange({ kind: "AUTO_RELEASED", matchId, refereeId, reason });
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
export async function releaseObjectingReferee(matchId: number, refereeId: number): Promise<boolean> {
  const tournamentId = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockLaunchMatch(connection, matchId);
      if (!row || nullableId(row.referee_user_id) !== refereeId || row.status === "COMPLETED") return null;
      // Relue sous le verrou du match (même ordre que `writeReferee` : match
      // puis compte) : levée entre-temps, l'opposition ne retire plus rien.
      if (!(await refereeObjectionUpheld(connection, refereeId, true))) return null;
      await connection.execute(`UPDATE bg_matches SET referee_user_id = NULL, referee_ready_at = NULL WHERE id = ?`, [
        matchId,
      ]);
      if (row.tournament_state === "RUNNING") await launchIfAllReady(connection, matchId);
      queueRefereeChange(connection, { kind: "OBJECTION_RELEASED", matchId, refereeId });
      return Number(row.tournament_id);
    }),
  );
  if (tournamentId === null) return false;
  publishMatchUpdatedEvent(tournamentId);
  return true;
}
