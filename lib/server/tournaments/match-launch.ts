/**
 * Lancement d'un match : « Prêt » des parties, lancement forcé ou d'office,
 * inscription d'un caster et désignation de l'équipe hôte.
 *
 * Toute la règle vit dans le module pur `lib/shared/match-launch.ts` ; ce
 * fichier l'applique à la base, sous le verrou de la ligne du match, et publie
 * l'événement qui réveille les pages ouvertes — les « Prêt » voyagent ensuite
 * dans l'instantané du flux SSE, comme le reste du plateau.
 *
 * Voir `docs/features/MATCH_LAUNCH.md`.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
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
  matchLaunchPhase,
  type CastBlock,
  type CasterIdentity,
  type LaunchViewerRole,
  type MatchLaunchInput,
} from "@/lib/shared/match-launch";
import type { MatchStatus, TeamRole } from "@/lib/shared/types";
import { publishUpdatedEvent } from "./notifications";

export type LaunchMatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_state: string;
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
  caster_user_id: number | null;
  caster_ready_at: Date | string | null;
  host_team_id: number | null;
};

const LAUNCH_MATCH_COLUMNS = `
  m.id, m.tournament_id, t.state AS tournament_state, m.status, m.is_bye,
  m.team1_id, m.team2_id, t1.is_ghost AS team1_is_ghost, t2.is_ghost AS team2_is_ghost,
  m.start_at, m.lobby_opened_at, m.launch_pairing, m.launched_at, m.team1_ready_at,
  m.team2_ready_at, m.caster_user_id, m.caster_ready_at, m.host_team_id`;

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
export function rowLaunchState(row: LaunchMatchRow) {
  return currentLaunchState(
    {
      launchPairing: row.launch_pairing ?? null,
      lobbyOpenedAt: toIso(row.lobby_opened_at),
      launchedAt: toIso(row.launched_at),
      team1ReadyAt: toIso(row.team1_ready_at),
      team2ReadyAt: toIso(row.team2_ready_at),
      casterReadyAt: toIso(row.caster_ready_at),
    },
    nullableId(row.team1_id),
    nullableId(row.team2_id),
  );
}

export function toLaunchInput(row: LaunchMatchRow): MatchLaunchInput {
  return {
    status: row.status,
    team1Id: nullableId(row.team1_id),
    team2Id: nullableId(row.team2_id),
    startAt: toIso(row.start_at),
    launchedAt: rowLaunchState(row).launchedAt,
  };
}

export function rowReadiness(row: LaunchMatchRow) {
  const launch = rowLaunchState(row);
  return launchReadiness({
    team1ReadyAt: launch.team1ReadyAt,
    team2ReadyAt: launch.team2ReadyAt,
    team1IsGhost: Number(row.team1_is_ghost ?? 0) === 1,
    team2IsGhost: Number(row.team2_is_ghost ?? 0) === 1,
    casterUserId: nullableId(row.caster_user_id),
    casterReadyAt: launch.casterReadyAt,
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
         team1_ready_at = NULL, team2_ready_at = NULL, caster_ready_at = NULL
     WHERE id = ?`,
    [key, row.id],
  );
  row.launch_pairing = key;
  row.lobby_opened_at = null;
  row.launched_at = null;
  row.team1_ready_at = null;
  row.team2_ready_at = null;
  row.caster_ready_at = null;

  // Un caster peut s'inscrire sur un match dont les créneaux sont encore vides
  // — l'inscription ne peut alors rien vérifier. Si l'appariement qui arrive
  // compte son équipe, il joue ce match : il ne peut plus le caster.
  if (row.caster_user_id !== null) {
    const casterId = Number(row.caster_user_id);
    const playing = await resolveTeamParty(connection, row, casterId);
    if (playing) {
      await connection.execute(
        `UPDATE bg_matches SET caster_user_id = NULL, caster_ready_at = NULL WHERE id = ?`,
        [row.id],
      );
      row.caster_user_id = null;
    }
  }
}

/**
 * Relit le match **sous verrou** de sa seule ligne (`FOR UPDATE OF m`) : les
 * tables jointes ne sont que lues, et verrouiller la ligne du tournoi ferait
 * attendre tout le moteur derrière un clic sur « Prêt ».
 */
async function lockLaunchMatch(
  connection: PoolConnection,
  matchId: number,
): Promise<LaunchMatchRow | null> {
  const [rows] = await connection.execute<LaunchMatchRow[]>(
    `SELECT ${LAUNCH_MATCH_COLUMNS} ${LAUNCH_MATCH_FROM} WHERE m.id = ? LIMIT 1 FOR UPDATE OF m`,
    [matchId],
  );
  return rows[0] ?? null;
}

async function inTransaction<T>(run: (connection: PoolConnection) => Promise<T>): Promise<T> {
  return withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const result = await run(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    }
  });
}

/** Partie que le lecteur représente dans ce match, et sa qualité à y agir. */
export type MatchParty = { role: LaunchViewerRole; canDeclareReady: boolean };

/**
 * Le lecteur est-il partie de ce match — joueur d'une des deux engagées
 * (appartenance **en cours**, ou entrée solo), ou son caster ?
 */
export async function resolveMatchParty(
  connection: PoolConnection,
  match: { team1_id: number | null; team2_id: number | null; caster_user_id: number | null },
  userId: number,
): Promise<MatchParty | null> {
  // Le rôle de joueur prime : qui joue le match ne le caste pas, même si une
  // inscription faite avant que son équipe n'arrive est encore en base.
  const team = await resolveTeamParty(connection, match, userId);
  if (team) return team;
  if (match.caster_user_id !== null && Number(match.caster_user_id) === userId) {
    return { role: "CASTER", canDeclareReady: true };
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
 * chaque écriture qui peut compléter la liste (un « Prêt », le départ du caster).
 */
async function launchIfAllReady(connection: PoolConnection, matchId: number): Promise<boolean> {
  const row = await lockLaunchMatch(connection, matchId);
  if (!row) return false;
  await adoptCurrentPairing(connection, row);
  if (matchLaunchPhase(toLaunchInput(row), Date.now()) !== "LOBBY") return false;
  if (!allPartiesReady(rowReadiness(row))) return false;
  await connection.execute(`UPDATE bg_matches SET launched_at = NOW() WHERE id = ?`, [matchId]);
  return true;
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

    // Nom de colonne tiré d'une table fermée, jamais de l'entrée.
    const column =
      party.role === "CASTER"
        ? "caster_ready_at"
        : party.role === "TEAM1"
          ? "team1_ready_at"
          : "team2_ready_at";
    await connection.execute(
      `UPDATE bg_matches
       SET ${column} = ${ready ? "NOW()" : "NULL"},
           lobby_opened_at = COALESCE(lobby_opened_at, NOW())
       WHERE id = ?`,
      [matchId],
    );
    const launchedNow = ready ? await launchIfAllReady(connection, matchId) : false;
    return { tournamentId: Number(row.tournament_id), launched: launchedNow };
  });
  publishUpdatedEvent(tournamentId);
  return { launched };
}

/**
 * Lance le match sans attendre les « Prêt » manquants (arbitrage). Possible
 * dès que le match est jouable, heure de début atteinte ou non.
 *
 * @throws `MATCH_NOT_FOUND` | `TOURNAMENT_NOT_RUNNING` | `MATCH_ALREADY_LAUNCHED`
 *   | `MATCH_NOT_LAUNCHABLE`
 */
export async function forceLaunchMatch(matchId: number): Promise<void> {
  const tournamentId = await inTransaction(async (connection) => {
    const row = await lockLaunchMatch(connection, matchId);
    if (!row) throw new Error("MATCH_NOT_FOUND");
    if (row.tournament_state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
    const phase = matchLaunchPhase(toLaunchInput(row), Date.now());
    if (phase === "LAUNCHED") throw new Error("MATCH_ALREADY_LAUNCHED");
    if (phase === "NONE") throw new Error("MATCH_NOT_LAUNCHABLE");
    await adoptCurrentPairing(connection, row);
    await connection.execute(
      `UPDATE bg_matches
       SET launched_at = NOW(), lobby_opened_at = COALESCE(lobby_opened_at, NOW())
       WHERE id = ?`,
      [matchId],
    );
    return Number(row.tournament_id);
  });
  publishUpdatedEvent(tournamentId);
}

type CasterIdentityRow = RowDataPacket & {
  discord_verified_at: Date | string | null;
  discord_pseudo: string | null;
  blizzard_sub: string | null;
  overwatch_battletag: string | null;
  is_deleted: number;
};

/** Identité d'un caster telle que la règle de `castBlockReason` la lit. */
export async function loadCasterIdentity(
  connection: PoolConnection,
  userId: number,
): Promise<CasterIdentity> {
  const [rows] = await connection.execute<CasterIdentityRow[]>(
    `SELECT discord_verified_at, discord_pseudo, blizzard_sub, overwatch_battletag, is_deleted
     FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row || Number(row.is_deleted) === 1) return { discordVerified: false, blizzardLinked: false };
  return {
    discordVerified: row.discord_verified_at !== null && Boolean(row.discord_pseudo),
    blizzardLinked: row.blizzard_sub !== null && Boolean(row.overwatch_battletag),
  };
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
 * Inscrit le lecteur comme caster du match. `hasLivePermission` est la
 * permission `live`, établie par la route.
 *
 * @throws `NOT_CASTER` | `CASTER_IDENTITY_REQUIRED` | `MATCH_NOT_FOUND`
 *   | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE` | `CASTER_IS_PLAYER`
 *   | `MATCH_ALREADY_CASTED`
 */
export async function claimMatchCast(
  matchId: number,
  userId: number,
  hasLivePermission: boolean,
): Promise<void> {
  const tournamentId = await inTransaction(async (connection) => {
    const block = castBlockReason(hasLivePermission, await loadCasterIdentity(connection, userId));
    if (block) throw new Error(block);

    const row = await lockLaunchMatch(connection, matchId);
    if (!row) throw new Error("MATCH_NOT_FOUND");
    if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
    if (Number(row.is_bye) === 1) throw new Error("MATCH_NOT_LAUNCHABLE");
    if (row.caster_user_id !== null) {
      if (Number(row.caster_user_id) === userId) return Number(row.tournament_id);
      throw new Error("MATCH_ALREADY_CASTED");
    }
    const party = await resolveMatchParty(connection, row, userId);
    if (party) throw new Error("CASTER_IS_PLAYER");

    await connection.execute(
      `UPDATE bg_matches SET caster_user_id = ?, caster_ready_at = NULL WHERE id = ?`,
      [userId, matchId],
    );
    return Number(row.tournament_id);
  });
  publishUpdatedEvent(tournamentId);
}

/**
 * Retire le caster du match — le sien, ou n'importe lequel pour l'arbitrage.
 * Si les deux équipes étaient prêtes et n'attendaient que lui, le match part.
 *
 * @throws `MATCH_NOT_FOUND` | `NOT_MATCH_CASTER`
 */
export async function releaseMatchCast(
  matchId: number,
  userId: number,
  canManage: boolean,
): Promise<void> {
  const tournamentId = await inTransaction(async (connection) => {
    const row = await lockLaunchMatch(connection, matchId);
    if (!row) throw new Error("MATCH_NOT_FOUND");
    if (row.caster_user_id === null) return Number(row.tournament_id);
    if (Number(row.caster_user_id) !== userId && !canManage) throw new Error("NOT_MATCH_CASTER");

    await connection.execute(
      `UPDATE bg_matches SET caster_user_id = NULL, caster_ready_at = NULL WHERE id = ?`,
      [matchId],
    );
    if (row.tournament_state === "RUNNING") await launchIfAllReady(connection, matchId);
    return Number(row.tournament_id);
  });
  publishUpdatedEvent(tournamentId);
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
  publishUpdatedEvent(tournamentId);
}

/**
 * Entretien du lancement d'un tournoi en cours, appelé par la synchronisation
 * passive (`syncTournamentState`) dans **sa** transaction :
 *
 * - pose `lobby_opened_at` sur les matchs qui viennent d'entrer en lancement
 *   (c'est l'origine du délai de lancement d'office) ;
 * - lance ceux dont toutes les parties sont prêtes — deux fantômes le sont
 *   d'office, et personne ne cliquerait pour elles ;
 * - lance d'office ceux dont le délai est écoulé.
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
  const [rows] = await connection.execute<LaunchMatchRow[]>(
    `SELECT ${LAUNCH_MATCH_COLUMNS} ${LAUNCH_MATCH_FROM}
     WHERE m.tournament_id = ? AND m.status = 'READY'
       AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
       AND (m.launched_at IS NULL
            OR NOT (m.launch_pairing <=> CONCAT(m.team1_id, ':', m.team2_id)))`,
    [tournamentId],
  );
  const now = Date.now();
  let changed = 0;
  for (const candidate of rows) {
    // Premier tri sur la lecture ordinaire, puis **relecture sous verrou**
    // avant toute écriture : un « Prêt » validé entre les deux serait sinon
    // effacé par la remise à zéro d'un appariement lu périmé, ou un lancement
    // décidé sur un « Prêt » tout juste retiré.
    if (matchLaunchPhase(toLaunchInput(candidate), now) !== "LOBBY") continue;
    const row = await lockLaunchMatch(connection, Number(candidate.id));
    if (!row || row.status !== "READY" || matchLaunchPhase(toLaunchInput(row), now) !== "LOBBY") {
      continue;
    }
    const stale = row.launch_pairing !== launchPairingKey(nullableId(row.team1_id), nullableId(row.team2_id));
    await adoptCurrentPairing(connection, row);
    const launch =
      allPartiesReady(rowReadiness(row)) || isAutoLaunchDue(toIso(row.lobby_opened_at), now);
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
  return changed;
}
