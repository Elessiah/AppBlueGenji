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
  rowLaunchState,
  rowReadiness,
  toLaunchInput,
  type LaunchMatchRow,
} from "./match-launch";
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

async function loadCandidates(
  connection: PoolConnection,
  userId: number,
  teamIds: number[],
): Promise<CandidateRow[]> {
  const teamFilter =
    teamIds.length > 0
      ? `OR m.team1_id IN (${teamIds.map(() => "?").join(", ")})
         OR m.team2_id IN (${teamIds.map(() => "?").join(", ")})`
      : "";
  const [rows] = await connection.execute<CandidateRow[]>(
    `SELECT
       m.id, m.tournament_id, t.state AS tournament_state, m.status, m.is_bye,
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
       AND (m.caster_user_id = ? ${teamFilter})
     ORDER BY m.start_at IS NULL, m.start_at, m.id`,
    [userId, ...teamIds, ...teamIds],
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
  if (row.caster_user_id !== null && Number(row.caster_user_id) === userId) {
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

/** Matchs du lecteur à présenter dans la modale de lancement. */
export async function listViewerMatchLaunches(viewer: LaunchViewer): Promise<MatchLaunchInfo[]> {
  return withConnection(async (connection) => {
    const teams = await loadViewerTeams(connection, viewer.id);
    const teamIds = [...teams.keys()];
    let rows = await loadCandidates(connection, viewer.id, teamIds);
    if (await maintainIfDue(connection, rows)) {
      rows = await loadCandidates(connection, viewer.id, teamIds);
    }

    const now = Date.now();
    const visible = rows
      .map((row) => ({ row, phase: matchLaunchPhase(toLaunchInput(row), now) }))
      .filter(({ phase }) => phase !== "NONE");
    if (visible.length === 0) return [];

    // Contacts : seulement pour les matchs en lancement ou lancés.
    const exposed = visible.filter(({ phase }) => phase === "LOBBY" || phase === "LAUNCHED");
    const rosterTeamIds = new Set<number>();
    const userIds = new Set<number>();
    for (const { row } of visible) {
      if (row.caster_user_id !== null) userIds.add(Number(row.caster_user_id));
    }
    for (const { row } of exposed) {
      for (const side of [1, 2] as const) {
        const teamId = side === 1 ? row.team1_id : row.team2_id;
        const ghost = Number((side === 1 ? row.team1_is_ghost : row.team2_is_ghost) ?? 0) === 1;
        const solo = side === 1 ? row.team1_solo_user_id : row.team2_solo_user_id;
        if (teamId === null || ghost) continue;
        if (solo !== null) userIds.add(Number(solo));
        else rosterTeamIds.add(Number(teamId));
      }
    }

    const rosters = new Map<number, MemberRow[]>();
    if (rosterTeamIds.size > 0) {
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
    }

    const users = new Map<number, UserRow>();
    if (userIds.size > 0) {
      const ids = [...userIds];
      const [found] = await connection.execute<UserRow[]>(
        `SELECT id, pseudo, discord_pseudo, discord_verified_at, overwatch_battletag, blizzard_sub,
                visible_overwatch, is_deleted
         FROM bg_users WHERE id IN (${ids.map(() => "?").join(", ")})`,
        ids,
      );
      for (const user of found) users.set(Number(user.id), user);
    }

    const result: MatchLaunchInfo[] = [];
    for (const { row, phase } of visible) {
      const party = viewerRole(row, viewer.id, teams);
      if (!party) continue;
      const readiness = rowReadiness(row);
      const exposes = phase === "LOBBY" || phase === "LAUNCHED";

      const side = (index: 1 | 2): LaunchSide => {
        const teamId = Number(index === 1 ? row.team1_id : row.team2_id);
        const isGhost = Number((index === 1 ? row.team1_is_ghost : row.team2_is_ghost) ?? 0) === 1;
        const soloUserId = index === 1 ? row.team1_solo_user_id : row.team2_solo_user_id;
        let contacts: LaunchContact[] = [];
        if (exposes && !isGhost) {
          if (soloUserId !== null) {
            const user = users.get(Number(soloUserId));
            if (user && Number(user.is_deleted) === 0) {
              contacts = pickLaunchContacts([toCandidate({ ...user, user_id: user.id, roles: [] })]).map(
                (contact) => filterContact(contact, viewer, Number(user.visible_overwatch) === 1),
              );
            }
          } else {
            const members = rosters.get(teamId) ?? [];
            const visibility = new Map(
              members.map((m) => [Number(m.user_id), Number(m.visible_overwatch) === 1]),
            );
            contacts = pickLaunchContacts(
              members.map((m) => toCandidate({ ...m, roles: parseRoles(m.roles_json) })),
            ).map((contact) => filterContact(contact, viewer, visibility.get(contact.userId) ?? false));
          }
        }
        return {
          teamId,
          name: (index === 1 ? row.team1_name : row.team2_name) ?? "—",
          logoUrl: localUploadUrl(index === 1 ? row.team1_logo_url : row.team2_logo_url),
          isGhost,
          isSolo: soloUserId !== null,
          ready: index === 1 ? readiness.team1Ready : readiness.team2Ready,
          contacts,
        };
      };

      let caster: LaunchCaster | null = null;
      if (row.caster_user_id !== null) {
        const user = users.get(Number(row.caster_user_id));
        if (user && Number(user.is_deleted) === 0) {
          const contact = exposes
            ? filterContact(
                {
                  userId: Number(user.id),
                  pseudo: user.pseudo,
                  roles: [],
                  discordTag: user.discord_verified_at !== null ? user.discord_pseudo : null,
                  battletag: user.overwatch_battletag,
                  battletagVerified: user.blizzard_sub !== null,
                },
                viewer,
                Number(user.visible_overwatch) === 1,
              )
            : null;
          caster = {
            userId: Number(user.id),
            pseudo: user.pseudo,
            discordTag: contact?.discordTag ?? null,
            battletag: contact?.battletag ?? null,
            battletagVerified: contact?.battletagVerified ?? false,
            ready: readiness.casterReady,
          };
        }
      }

      const launch = rowLaunchState(row);
      const lobbyOpenedAt = launch.lobbyOpenedAt;
      result.push({
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
        team1: side(1),
        team2: side(2),
        caster,
        viewer: {
          role: party.role,
          canDeclareReady: party.canDeclareReady,
          ready:
            party.role === "CASTER"
              ? readiness.casterReady
              : party.role === "TEAM1"
                ? readiness.team1Ready
                : readiness.team2Ready,
        },
      });
    }
    return result;
  });
}
