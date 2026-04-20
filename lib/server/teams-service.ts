import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import type { TeamDetailResponse, TeamListItem, TeamMember, TeamRole } from "@/lib/shared/types";
import { getUserIdByPseudo, sanitizeRoles } from "@/lib/server/users-service";

type TeamRow = RowDataPacket & {
  id: number;
  name: string;
  logo_url: string | null;
  created_at: Date;
  members_count: number;
};

type TeamMemberRow = RowDataPacket & {
  membership_id: number;
  user_id: number;
  pseudo: string;
  avatar_url: string | null;
  roles_json: string;
  joined_at: Date;
};

type TeamHistoryRow = RowDataPacket & {
  tournament_id: number;
  tournament_name: string;
  tournament_state: "UPCOMING" | "REGISTRATION" | "RUNNING" | "FINISHED";
  final_rank: number | null;
  wins: number;
  losses: number;
  played_at: Date;
};

function mapMember(row: TeamMemberRow): TeamMember {
  return {
    membershipId: Number(row.membership_id),
    userId: Number(row.user_id),
    pseudo: row.pseudo,
    avatarUrl: row.avatar_url,
    roles: parseRoles(row.roles_json),
    joinedAt: toIso(row.joined_at) ?? new Date().toISOString(),
  };
}

async function userOwnsTeam(teamId: number, userId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { roles_json: string })[]>(
    `SELECT roles_json
     FROM bg_team_members
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL
     LIMIT 1`,
    [teamId, userId],
  );

  if (rows.length === 0) return false;
  const roles = parseRoles(rows[0].roles_json);
  return roles.includes("OWNER");
}

export async function listTeams(): Promise<TeamListItem[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<TeamRow[]>(
    `SELECT
      t.id,
      t.name,
      t.logo_url,
      t.created_at,
      COALESCE(COUNT(tm.id), 0) AS members_count
     FROM bg_teams t
     LEFT JOIN bg_team_members tm ON tm.team_id = t.id AND tm.left_at IS NULL
     GROUP BY t.id, t.name, t.logo_url, t.created_at
     ORDER BY t.name ASC`,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    logoUrl: row.logo_url,
    membersCount: Number(row.members_count),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function createTeam(ownerUserId: number, name: string, logoUrl: string | null): Promise<number> {
  const db = await getDatabase();

  const [existingMembership] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id
     FROM bg_team_members
     WHERE user_id = ?
       AND left_at IS NULL
     LIMIT 1`,
    [ownerUserId],
  );

  if (existingMembership.length > 0) {
    throw new Error("USER_ALREADY_IN_TEAM");
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [teamInsert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO bg_teams (name, logo_url)
       VALUES (?, ?)`,
      [name.trim(), logoUrl],
    );

    const ownerRoles = JSON.stringify(["OWNER"]);

    await connection.execute(
      `INSERT INTO bg_team_members (team_id, user_id, roles_json)
       VALUES (?, ?, ?)`,
      [teamInsert.insertId, ownerUserId, ownerRoles],
    );

    await connection.commit();
    return Number(teamInsert.insertId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getTeamDetail(teamId: number, viewerUserId: number): Promise<TeamDetailResponse | null> {
  const db = await getDatabase();

  const [teams] = await db.execute<(RowDataPacket & { id: number; name: string; logo_url: string | null; created_at: Date })[]>(
    `SELECT id, name, logo_url, created_at
     FROM bg_teams
     WHERE id = ?
     LIMIT 1`,
    [teamId],
  );

  if (teams.length === 0) return null;

  const [membersRows] = await db.execute<TeamMemberRow[]>(
    `SELECT
      tm.id AS membership_id,
      tm.user_id,
      u.pseudo,
      u.avatar_url,
      tm.roles_json,
      tm.joined_at
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id = ?
       AND tm.left_at IS NULL
     ORDER BY u.pseudo ASC`,
    [teamId],
  );

  const [historyRows] = await db.execute<TeamHistoryRow[]>(
    `SELECT
      t.id AS tournament_id,
      t.name AS tournament_name,
      t.state AS tournament_state,
      r.final_rank,
      COALESCE(SUM(CASE WHEN m.winner_team_id = r.team_id THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN m.loser_team_id = r.team_id THEN 1 ELSE 0 END), 0) AS losses,
      COALESCE(t.finished_at, t.start_at) AS played_at
    FROM bg_tournament_registrations r
    JOIN bg_tournaments t ON t.id = r.tournament_id
    LEFT JOIN bg_matches m ON m.tournament_id = t.id
      AND (m.winner_team_id = r.team_id OR m.loser_team_id = r.team_id)
    WHERE r.team_id = ?
    GROUP BY t.id, t.name, t.state, r.final_rank, played_at
    ORDER BY played_at DESC`,
    [teamId],
  );

  const canManage = await userOwnsTeam(teamId, viewerUserId);

  return {
    team: {
      id: Number(teams[0].id),
      name: teams[0].name,
      logoUrl: teams[0].logo_url,
      createdAt: teams[0].created_at.toISOString(),
    },
    members: membersRows.map(mapMember),
    tournaments: historyRows.map((row) => ({
      tournamentId: Number(row.tournament_id),
      tournamentName: row.tournament_name,
      state: row.tournament_state,
      finalRank: row.final_rank === null ? null : Number(row.final_rank),
      wins: Number(row.wins),
      losses: Number(row.losses),
      playedAt: toIso(row.played_at) ?? new Date().toISOString(),
    })),
    canManage,
  };
}

export async function updateTeamMeta(
  requesterId: number,
  teamId: number,
  patch: { name?: string; logoUrl?: string | null },
): Promise<void> {
  const db = await getDatabase();
  if (!(await userOwnsTeam(teamId, requesterId))) {
    throw new Error("FORBIDDEN");
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (patch.name !== undefined) {
    updates.push("name = ?");
    params.push(patch.name.trim());
  }

  if (patch.logoUrl !== undefined) {
    updates.push("logo_url = ?");
    params.push(patch.logoUrl);
  }

  if (updates.length === 0) return;

  params.push(teamId);
  await db.execute(`UPDATE bg_teams SET ${updates.join(", ")} WHERE id = ?`, params);
}

export async function addTeamMember(
  requesterId: number,
  teamId: number,
  memberPseudo: string,
  roles: TeamRole[],
): Promise<void> {
  const db = await getDatabase();
  if (!(await userOwnsTeam(teamId, requesterId))) {
    throw new Error("FORBIDDEN");
  }

  const userId = await getUserIdByPseudo(memberPseudo);
  if (!userId) {
    throw new Error("USER_NOT_FOUND");
  }

  const [activeMembership] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id
     FROM bg_team_members
     WHERE user_id = ?
       AND left_at IS NULL
     LIMIT 1`,
    [userId],
  );

  if (activeMembership.length > 0) {
    throw new Error("USER_ALREADY_IN_TEAM");
  }

  const filteredRoles = sanitizeRoles(roles).filter((role) => role !== "OWNER");
  const payload = filteredRoles.length === 0 ? ["DPS"] : filteredRoles;

  await db.execute(
    `INSERT INTO bg_team_members (team_id, user_id, roles_json)
     VALUES (?, ?, ?)`,
    [teamId, userId, JSON.stringify(payload)],
  );
}

export async function updateTeamMemberRoles(
  requesterId: number,
  teamId: number,
  memberUserId: number,
  roles: TeamRole[],
): Promise<void> {
  const db = await getDatabase();
  if (!(await userOwnsTeam(teamId, requesterId))) {
    throw new Error("FORBIDDEN");
  }

  if (memberUserId === requesterId) {
    throw new Error("OWNER_CANNOT_EDIT_SELF");
  }

  const filteredRoles = sanitizeRoles(roles).filter((role) => role !== "OWNER");
  if (filteredRoles.length === 0) {
    throw new Error("MISSING_ROLE");
  }

  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_team_members
     SET roles_json = ?
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL`,
    [JSON.stringify(filteredRoles), teamId, memberUserId],
  );

  if (Number(res.affectedRows) === 0) {
    throw new Error("MEMBER_NOT_FOUND");
  }
}

export async function removeTeamMember(requesterId: number, teamId: number, memberUserId: number): Promise<void> {
  const db = await getDatabase();
  if (!(await userOwnsTeam(teamId, requesterId))) {
    throw new Error("FORBIDDEN");
  }

  if (memberUserId === requesterId) {
    throw new Error("OWNER_CANNOT_LEAVE");
  }

  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_team_members
     SET left_at = NOW()
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL`,
    [teamId, memberUserId],
  );

  if (Number(res.affectedRows) === 0) {
    throw new Error("MEMBER_NOT_FOUND");
  }
}

export async function getUserActiveTeam(userId: number): Promise<{ teamId: number; teamName: string } | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { team_id: number; team_name: string })[]>(
    `SELECT tm.team_id, t.name AS team_name
     FROM bg_team_members tm
     JOIN bg_teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?
       AND tm.left_at IS NULL
     LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) return null;

  return {
    teamId: Number(rows[0].team_id),
    teamName: rows[0].team_name,
  };
}

export async function isTeamOwner(userId: number, teamId: number): Promise<boolean> {
  return userOwnsTeam(teamId, userId);
}


