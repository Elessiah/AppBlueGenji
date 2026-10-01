/**
 * Lecture de la modale de lancement : les matchs du lecteur — joueur d'une des
 * deux engagées ou caster inscrit — qui approchent de leur heure, sont en
 * lancement ou se jouent, avec les contacts que chaque partie doit avoir sous
 * la main.
 *
 * **Exposition bornée.** Les contacts (tag Discord certifié, BattleTag) ne sont
 * rendus que pour un match **en lancement ou lancé**, et seulement à ses
 * parties : c'est la clause `sharesMatchLobby` de `canViewDiscordTag` et
 * `sharesLiveMatch` de `canViewBattletag`, que ce module est seul à établir.
 * Un match terminé sort de la liste, et ses contacts avec lui.
 *
 * Voir `docs/features/MATCH_LAUNCH.md`.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import { visibleBattletag } from "@/lib/shared/battletag-visibility";
import { visibleDiscordTag } from "@/lib/shared/discord-identity";
import {
  autoLaunchAt,
  canDeclareTeamReady,
  isAutoLaunchDue,
  matchLaunchPhase,
  pickLaunchContacts,
  resolveHostTeamId,
  type ContactCandidate,
  type LaunchCaster,
  type LaunchContact,
  type LaunchSide,
  type LaunchViewerRole,
  type MatchLaunchInfo,
} from "@/lib/shared/match-launch";
import type { PlatformRole } from "@/lib/shared/permissions";
import type { TeamRole } from "@/lib/shared/types";
import { localUploadUrl } from "@/lib/shared/uploads";
import {
  maintainMatchLaunches,
  releaseIneligibleCast,
  rowLaunchState,
  rowReadiness,
  toLaunchInput,
  type LaunchMatchRow,
} from "./match-launch";
import { castEligibilityBlock } from "./cast-eligibility";
import { cachedTournamentList } from "./list-cache";
import { publishMatchUpdatedEvent } from "./notifications";

/**
 * Horizon d'anticipation : un match dont l'heure tombe dans l'heure est déjà
 * rendu (sans contacts), pour que la page ouvre la modale à la seconde dite par
 * une minuterie plutôt qu'au prochain passage de l'interrogation.
 */
export const LAUNCH_LOOKAHEAD_MINUTES = 60;

/** Le lecteur tel que ce module le lit. */
export type LaunchViewer = { id: number; isAdmin?: boolean; roles?: readonly PlatformRole[] };

type CandidateRow = LaunchMatchRow & {
  tournament_name: string;
  team1_name: string | null;
  team2_name: string | null;
  team1_logo_url: string | null;
  team2_logo_url: string | null;
  team1_solo_user_id: number | null;
  team2_solo_user_id: number | null;
};

type MemberRow = RowDataPacket & {
  team_id: number;
  user_id: number;
  pseudo: string;
  roles_json: unknown;
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
  overwatch_battletag: string | null;
  blizzard_sub: string | null;
  visible_overwatch: number;
};

type UserRow = RowDataPacket & {
  id: number;
  pseudo: string;
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
  overwatch_battletag: string | null;
  blizzard_sub: string | null;
  visible_overwatch: number;
  is_deleted: number;
  is_admin: number;
  platform_roles_json: unknown;
};

type ViewerTeams = Map<number, { roles: TeamRole[]; solo: boolean }>;

/** Équipes que le lecteur représente : appartenances en cours et entrée solo. */
async function loadViewerTeams(connection: PoolConnection, userId: number): Promise<ViewerTeams> {
  const teams: ViewerTeams = new Map();
  const [members] = await connection.execute<
    (RowDataPacket & { team_id: number; roles_json: unknown })[]
  >(`SELECT team_id, roles_json FROM bg_team_members WHERE user_id = ? AND left_at IS NULL`, [userId]);
  for (const row of members) {
    teams.set(Number(row.team_id), { roles: parseRoles(row.roles_json), solo: false });
  }
  const [solo] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_teams WHERE solo_user_id = ?`,
    [userId],
  );
  for (const row of solo) teams.set(Number(row.id), { roles: [], solo: true });
  return teams;
}

/**
 * Un tournoi est-il en cours sur le site ? Sans lui, aucun match n'est à
 * présenter, à personne : la modale interroge sa route toutes les minutes sur
 * chaque onglet ouvert d'un compte connecté, et chaque appel faisait trois
 * lectures pour rendre une liste vide.
 *
 * La réponse est **la même pour tous** : elle est mutualisée avec les listes de
 * tournois, et vidée avec elles à chaque écriture sur un tournoi
 * (`publishUpdatedEvent`) — un tournoi qui démarre est donc vu aussitôt. Le
 * retard ne tient qu'à une bascule d'état que personne n'a encore écrite, et
 * aucun match n'existe alors en base pour ce tournoi.
 */
function hasRunningTournament(): Promise<boolean> {
  return cachedTournamentList("running-exists", () =>
    withConnection(async (connection) => {
      const [rows] = await connection.execute<(RowDataPacket & { running: number })[]>(
        `SELECT EXISTS (SELECT 1 FROM bg_tournaments WHERE state = 'RUNNING') AS running`,
      );
      return Number(rows[0]?.running ?? 0) === 1;
    }),
  );
}

/**
 * Matchs à présenter au lecteur : ceux d'une équipe qu'il représente (membre
 * en cours ou entrée solo) ou qu'il caste. Les équipes du lecteur sont lues
 * **dans** la requête : un lecteur qui n'a aucun match — le cas courant — ne
 * coûte qu'une lecture, et ses rôles ne sont relus que s'il en a un.
 */
async function loadCandidates(connection: PoolConnection, userId: number): Promise<CandidateRow[]> {
  const viewerTeams = `(SELECT tm.team_id FROM bg_team_members tm
                        WHERE tm.user_id = ? AND tm.left_at IS NULL
                        UNION SELECT st.id FROM bg_teams st WHERE st.solo_user_id = ?)`;
  const [rows] = await connection.execute<CandidateRow[]>(
    `SELECT
       m.id, m.tournament_id, t.state AS tournament_state, t.referee_scheduling, m.status, m.is_bye,
       m.team1_id, m.team2_id, t1.is_ghost AS team1_is_ghost, t2.is_ghost AS team2_is_ghost,
       m.start_at, m.lobby_opened_at, m.launch_pairing, m.launched_at, m.team1_ready_at, m.team2_ready_at,
       m.caster_user_id, m.caster_ready_at, m.host_team_id,
       t.name AS tournament_name,
       t1.name AS team1_name, t2.name AS team2_name,
       t1.logo_url AS team1_logo_url, t2.logo_url AS team2_logo_url,
       t1.solo_user_id AS team1_solo_user_id, t2.solo_user_id AS team2_solo_user_id
     FROM bg_matches m
     JOIN bg_tournaments t ON t.id = m.tournament_id
     LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
     LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
     WHERE t.state = 'RUNNING'
       AND m.status IN ('READY', 'AWAITING_CONFIRMATION')
       AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
       AND (m.start_at IS NULL OR m.start_at <= NOW() + INTERVAL ${LAUNCH_LOOKAHEAD_MINUTES} MINUTE)
       -- Un match à planifier n'a rien à présenter : ni heure à guetter, ni
       -- « Prêt » à donner, ni contacts à exposer.
       AND (m.start_at IS NOT NULL OR t.referee_scheduling = 0)
       AND (m.caster_user_id = ?
            OR m.team1_id IN ${viewerTeams}
            OR m.team2_id IN ${viewerTeams})
     ORDER BY m.start_at IS NULL, m.start_at, m.id`,
    [userId, userId, userId, userId, userId],
  );
  return rows;
}

function toCandidate(row: {
  user_id: number;
  pseudo: string;
  roles: TeamRole[];
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
  overwatch_battletag: string | null;
  blizzard_sub: string | null;
}): ContactCandidate {
  return {
    userId: Number(row.user_id),
    pseudo: row.pseudo,
    roles: row.roles,
    discordTag: row.discord_pseudo,
    discordVerified: row.discord_verified_at !== null,
    battletag: row.overwatch_battletag,
    blizzardLinked: row.blizzard_sub !== null,
  };
}

/**
 * Applique les règles de visibilité **à la sortie**, même si le choix des
 * contacts n'a gardé qu'un tag certifié : la règle vit dans
 * `canViewDiscordTag` / `canViewBattletag`, pas dans ce module.
 */
function filterContact(
  contact: LaunchContact,
  viewer: LaunchViewer,
  visibleOverwatch: boolean,
): LaunchContact {
  return {
    ...contact,
    discordTag: visibleDiscordTag(contact.discordTag, viewer, {
      userId: contact.userId,
      verified: contact.discordTag !== null,
      sharesMatchLobby: true,
    }),
    battletag: visibleBattletag(contact.battletag, viewer, {
      userId: contact.userId,
      visible: visibleOverwatch,
      sharesLiveMatch: true,
    }),
  };
}

function viewerRole(
  row: CandidateRow,
  userId: number,
  teams: ViewerTeams,
  castRevoked: boolean,
): { role: LaunchViewerRole; canDeclareReady: boolean } | null {
  // Le rôle de joueur prime, comme dans `resolveMatchParty`.
  for (const [role, teamId] of [
    ["TEAM1", row.team1_id],
    ["TEAM2", row.team2_id],
  ] as const) {
    const membership = teamId === null ? undefined : teams.get(Number(teamId));
    if (membership) {
      return { role, canDeclareReady: membership.solo || canDeclareTeamReady(membership.roles) };
    }
  }
  if (!castRevoked && row.caster_user_id !== null && Number(row.caster_user_id) === userId) {
    return { role: "CASTER", canDeclareReady: true };
  }
  return null;
}

/**
 * Lance d'office ce qui doit l'être avant de répondre : la modale interroge
 * toutes les quelques secondes, et sans ce passage un lancement d'office
 * attendrait que quelqu'un ouvre la liste des tournois.
 */
async function maintainIfDue(connection: PoolConnection, rows: CandidateRow[]): Promise<boolean> {
  const now = Date.now();
  const due = new Set<number>();
  for (const row of rows) {
    if (matchLaunchPhase(toLaunchInput(row), now) !== "LOBBY") continue;
    const opened = rowLaunchState(row).lobbyOpenedAt;
    if (opened === null || isAutoLaunchDue(opened, now)) {
      due.add(Number(row.tournament_id));
    }
  }
  for (const tournamentId of due) {
    await connection.beginTransaction();
    try {
      const changed = await maintainMatchLaunches(connection, tournamentId);
      await connection.commit();
      if (changed > 0) publishMatchUpdatedEvent(tournamentId);
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      console.error("[match-launch] entretien impossible", error);
    }
  }
  return due.size > 0;
}

type LaunchPhase = ReturnType<typeof matchLaunchPhase>;
type VisibleLaunch = { row: CandidateRow; phase: LaunchPhase };

/** Ce qu'il faut pour rédiger la présentation d'un match au lecteur. */
type LaunchContext = {
  viewer: LaunchViewer;
  users: Map<number, UserRow>;
  rosters: Map<number, MemberRow[]>;
  castRevoked: boolean;
  readiness: ReturnType<typeof rowReadiness>;
  /** Contacts : seulement pour les matchs en lancement ou lancés. */
  exposes: boolean;
};

function exposesContacts(phase: LaunchPhase): boolean {
  return phase === "LOBBY" || phase === "LAUNCHED";
}

/** Un côté du match tel que la ligne le décrit. */
function rowSide(row: CandidateRow, index: 1 | 2) {
  const first = index === 1;
  return {
    teamId: first ? row.team1_id : row.team2_id,
    isGhost: Number((first ? row.team1_is_ghost : row.team2_is_ghost) ?? 0) === 1,
    soloUserId: first ? row.team1_solo_user_id : row.team2_solo_user_id,
    name: first ? row.team1_name : row.team2_name,
    logoUrl: first ? row.team1_logo_url : row.team2_logo_url,
  };
}

/**
 * Comptes et rosters à lire : le caster de tout match présenté, et les joueurs
 * des seuls matchs dont les contacts sont exposés.
 */
function collectContactIds(visible: readonly VisibleLaunch[]): {
  rosterTeamIds: Set<number>;
  userIds: Set<number>;
} {
  const exposed = visible.filter(({ phase }) => exposesContacts(phase));
  const rosterTeamIds = new Set<number>();
  const userIds = new Set<number>();
  for (const { row } of visible) {
    if (row.caster_user_id !== null) userIds.add(Number(row.caster_user_id));
  }
  for (const { row } of exposed) {
    for (const index of [1, 2] as const) {
      const { teamId, isGhost, soloUserId } = rowSide(row, index);
      if (teamId === null || isGhost) continue;
      if (soloUserId !== null) userIds.add(Number(soloUserId));
      else rosterTeamIds.add(Number(teamId));
    }
  }
  return { rosterTeamIds, userIds };
}

async function loadRosters(
  connection: PoolConnection,
  rosterTeamIds: Set<number>,
): Promise<Map<number, MemberRow[]>> {
  const rosters = new Map<number, MemberRow[]>();
  if (rosterTeamIds.size === 0) return rosters;
  const ids = [...rosterTeamIds];
  const [members] = await connection.execute<MemberRow[]>(
    `SELECT tm.team_id, u.id AS user_id, u.pseudo, tm.roles_json, u.discord_pseudo,
            u.discord_verified_at, u.overwatch_battletag, u.blizzard_sub, u.visible_overwatch
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id IN (${ids.map(() => "?").join(", ")})
       AND tm.left_at IS NULL AND u.is_deleted = 0`,
    ids,
  );
  for (const member of members) {
    const list = rosters.get(Number(member.team_id)) ?? [];
    list.push(member);
    rosters.set(Number(member.team_id), list);
  }
  return rosters;
}

async function loadUsers(connection: PoolConnection, userIds: Set<number>): Promise<Map<number, UserRow>> {
  const users = new Map<number, UserRow>();
  if (userIds.size === 0) return users;
  const ids = [...userIds];
  const [found] = await connection.execute<UserRow[]>(
    `SELECT id, pseudo, discord_pseudo, discord_verified_at, overwatch_battletag, blizzard_sub,
            visible_overwatch, is_deleted, is_admin, platform_roles_json
     FROM bg_users WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  for (const user of found) users.set(Number(user.id), user);
  return users;
}

/**
 * Un caster n'est une partie du match que tant qu'il remplit la condition
 * de son inscription : elle est rejouée ici, à chaque lecture, sans quoi
 * un compte privé de `live` (ou d'identité) garderait les contacts.
 * L'inscription n'est retirée qu'avant le lancement, là où elle retient
 * un « Prêt » ; un match lancé garde son caster, seulement tu.
 *
 * Rend les matchs dont le caster est tu, et range dans `revokedCasts` les
 * inscriptions à retirer.
 */
function revokeIneligibleCasters(
  visible: readonly VisibleLaunch[],
  users: Map<number, UserRow>,
  revokedCasts: { matchId: number; casterId: number }[],
): Set<number> {
  const revoked = new Set<number>();
  for (const { row, phase } of visible) {
    if (row.caster_user_id === null) continue;
    const casterId = Number(row.caster_user_id);
    if (castEligibilityBlock(users.get(casterId)) !== null) {
      revoked.add(Number(row.id));
      if (phase !== "LAUNCHED") revokedCasts.push({ matchId: Number(row.id), casterId });
    }
  }
  return revoked;
}

/** Contacts d'une entrée solo : le joueur lui-même, s'il existe encore. */
function soloContacts(soloUserId: number, ctx: LaunchContext): LaunchContact[] {
  const user = ctx.users.get(Number(soloUserId));
  if (!user || Number(user.is_deleted) !== 0) return [];
  return pickLaunchContacts([toCandidate({ ...user, user_id: user.id, roles: [] })]).map((contact) =>
    filterContact(contact, ctx.viewer, Number(user.visible_overwatch) === 1),
  );
}

/** Contacts d'une équipe : choisis dans son roster en cours. */
function rosterContacts(teamId: number, ctx: LaunchContext): LaunchContact[] {
  const members = ctx.rosters.get(teamId) ?? [];
  const visibility = new Map(members.map((m) => [Number(m.user_id), Number(m.visible_overwatch) === 1]));
  return pickLaunchContacts(members.map((m) => toCandidate({ ...m, roles: parseRoles(m.roles_json) }))).map(
    (contact) => filterContact(contact, ctx.viewer, visibility.get(contact.userId) ?? false),
  );
}

function buildLaunchSide(row: CandidateRow, index: 1 | 2, ctx: LaunchContext): LaunchSide {
  const side = rowSide(row, index);
  const teamId = Number(side.teamId);
  let contacts: LaunchContact[] = [];
  if (ctx.exposes && !side.isGhost) {
    contacts = side.soloUserId === null ? rosterContacts(teamId, ctx) : soloContacts(side.soloUserId, ctx);
  }
  return {
    teamId,
    name: side.name ?? "—",
    logoUrl: localUploadUrl(side.logoUrl),
    isGhost: side.isGhost,
    isSolo: side.soloUserId !== null,
    ready: index === 1 ? ctx.readiness.team1Ready : ctx.readiness.team2Ready,
    contacts,
  };
}

function buildLaunchCaster(row: CandidateRow, ctx: LaunchContext): LaunchCaster | null {
  if (row.caster_user_id === null || ctx.castRevoked) return null;
  const user = ctx.users.get(Number(row.caster_user_id));
  if (!user || Number(user.is_deleted) !== 0) return null;
  const discordTag = user.discord_verified_at !== null ? user.discord_pseudo : null;
  const contact = ctx.exposes
    ? filterContact(
        {
          userId: Number(user.id),
          pseudo: user.pseudo,
          roles: [],
          discordTag,
          battletag: user.overwatch_battletag,
          battletagVerified: user.blizzard_sub !== null,
        },
        ctx.viewer,
        Number(user.visible_overwatch) === 1,
      )
    : null;
  return {
    userId: Number(user.id),
    pseudo: user.pseudo,
    discordTag: contact?.discordTag ?? null,
    battletag: contact?.battletag ?? null,
    battletagVerified: contact?.battletagVerified ?? false,
    ready: ctx.readiness.casterReady,
  };
}

function buildLaunchInfo(
  row: CandidateRow,
  phase: LaunchPhase,
  party: { role: LaunchViewerRole; canDeclareReady: boolean },
  ctx: LaunchContext,
): MatchLaunchInfo {
  const { readiness } = ctx;
  const caster = buildLaunchCaster(row, ctx);
  const launch = rowLaunchState(row);
  const lobbyOpenedAt = launch.lobbyOpenedAt;
  return {
    matchId: Number(row.id),
    tournamentId: Number(row.tournament_id),
    tournamentName: row.tournament_name,
    phase,
    startAt: toIso(row.start_at),
    lobbyOpenedAt,
    autoLaunchAt: phase === "LOBBY" ? autoLaunchAt(lobbyOpenedAt) : null,
    launchedAt: launch.launchedAt,
    hostTeamId: resolveHostTeamId(
      row.host_team_id === null ? null : Number(row.host_team_id),
      Number(row.team1_id),
      Number(row.team2_id),
    ),
    team1: buildLaunchSide(row, 1, ctx),
    team2: buildLaunchSide(row, 2, ctx),
    caster,
    viewer: {
      role: party.role,
      canDeclareReady: party.canDeclareReady,
      ready: {
        CASTER: readiness.casterReady,
        TEAM1: readiness.team1Ready,
        TEAM2: readiness.team2Ready,
      }[party.role],
    },
  };
}

/** Matchs du lecteur à présenter dans la modale de lancement. */
export async function listViewerMatchLaunches(viewer: LaunchViewer): Promise<MatchLaunchInfo[]> {
  if (!(await hasRunningTournament())) return [];

  const revokedCasts: { matchId: number; casterId: number }[] = [];
  const launches = await withConnection(async (connection) => {
    let rows = await loadCandidates(connection, viewer.id);
    if (rows.length === 0) return [];
    if (await maintainIfDue(connection, rows)) {
      rows = await loadCandidates(connection, viewer.id);
      if (rows.length === 0) return [];
    }
    const teams = await loadViewerTeams(connection, viewer.id);

    const now = Date.now();
    const visible = rows
      .map((row) => ({ row, phase: matchLaunchPhase(toLaunchInput(row), now) }))
      .filter(({ phase }) => phase !== "NONE" && phase !== "TO_PLAN");
    if (visible.length === 0) return [];

    const { rosterTeamIds, userIds } = collectContactIds(visible);
    const rosters = await loadRosters(connection, rosterTeamIds);
    const users = await loadUsers(connection, userIds);
    const revoked = revokeIneligibleCasters(visible, users, revokedCasts);

    const result: MatchLaunchInfo[] = [];
    for (const { row, phase } of visible) {
      const castRevoked = revoked.has(Number(row.id));
      const party = viewerRole(row, viewer.id, teams, castRevoked);
      if (!party) continue;
      result.push(
        buildLaunchInfo(row, phase, party, {
          viewer,
          users,
          rosters,
          castRevoked,
          readiness: rowReadiness(row),
          exposes: exposesContacts(phase),
        }),
      );
    }
    return result;
  });

  // Les contacts sont déjà retirés de la réponse ; l'inscription l'est ensuite,
  // sous verrou et après relecture, pour que le lancement n'attende plus le
  // « Prêt » d'un caster qui n'en est plus un. Un échec n'y change rien pour
  // ce lecteur : la prochaine lecture retentera.
  for (const cast of revokedCasts) {
    try {
      await releaseIneligibleCast(cast.matchId, cast.casterId);
    } catch (error) {
      console.error("[match-launch] retrait d'un caster non éligible impossible", error);
    }
  }
  return launches;
}
