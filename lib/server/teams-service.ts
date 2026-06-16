import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import type { TeamDetailResponse, TeamListItem, TeamMember, TeamRole } from "@/lib/shared/types";
import { getUserIdByPseudo, sanitizeRoles } from "@/lib/server/users-service";

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

async function getMemberRoles(teamId: number, userId: number): Promise<TeamRole[] | null> {
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
  if (rows.length === 0) return null;
  return parseRoles(rows[0].roles_json);
}

async function userCanManageTeam(teamId: number, userId: number): Promise<boolean> {
  const roles = await getMemberRoles(teamId, userId);
  if (!roles) return false;
  return roles.includes("OWNER") || roles.includes("MANAGER");
}

export async function listTeams(): Promise<TeamListItem[]> {
  const db = await getDatabase();

  // Get teams with member count, wins, losses
  const [teamRows] = await db.execute<
    (RowDataPacket & {
      id: number;
      name: string;
      logo_url: string | null;
      created_at: Date;
      members_count: number;
      wins: number;
      losses: number;
    })[]
  >(
    `SELECT
      t.id,
      t.name,
      t.logo_url,
      t.created_at,
      COALESCE(COUNT(DISTINCT tm.id), 0) AS members_count,
      COALESCE(SUM(CASE WHEN m.winner_team_id = t.id THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN m.status = 'COMPLETED' AND m.winner_team_id IS NOT NULL AND m.winner_team_id != t.id AND (m.team1_id = t.id OR m.team2_id = t.id) THEN 1 ELSE 0 END), 0) AS losses
     FROM bg_teams t
     LEFT JOIN bg_team_members tm ON tm.team_id = t.id AND tm.left_at IS NULL
     LEFT JOIN bg_matches m ON (m.team1_id = t.id OR m.team2_id = t.id)
     WHERE t.deleted_at IS NULL
     GROUP BY t.id, t.name, t.logo_url, t.created_at`,
  );

  // Get form data (last 10 matches per team) - simplified approach
  const allMatches = await db.execute<
    (RowDataPacket & {
      id: number;
      team1_id: number | null;
      team2_id: number | null;
      winner_team_id: number | null;
      created_at: Date;
    })[]
  >(
    `SELECT id, team1_id, team2_id, winner_team_id, created_at
     FROM bg_matches
     WHERE status = 'COMPLETED'
     ORDER BY created_at DESC
     LIMIT 1000`,
  );

  // Build form data for each team
  const formByTeam = new Map<number, ("w" | "l" | "d")[]>();
  const matchesPerTeam = new Map<number, number>();

  for (const match of allMatches[0]) {
    if (match.team1_id) {
      if (!matchesPerTeam.has(match.team1_id)) {
        matchesPerTeam.set(match.team1_id, 0);
        formByTeam.set(match.team1_id, []);
      }
      if (matchesPerTeam.get(match.team1_id)! < 10) {
        formByTeam.get(match.team1_id)!.push(match.winner_team_id === match.team1_id ? "w" : "l");
        matchesPerTeam.set(match.team1_id, matchesPerTeam.get(match.team1_id)! + 1);
      }
    }
    if (match.team2_id) {
      if (!matchesPerTeam.has(match.team2_id)) {
        matchesPerTeam.set(match.team2_id, 0);
        formByTeam.set(match.team2_id, []);
      }
      if (matchesPerTeam.get(match.team2_id)! < 10) {
        formByTeam.get(match.team2_id)!.push(match.winner_team_id === match.team2_id ? "w" : "l");
        matchesPerTeam.set(match.team2_id, matchesPerTeam.get(match.team2_id)! + 1);
      }
    }
  }

  // Get roster preview
  const [rosterRows] = await db.execute<
    (RowDataPacket & {
      team_id: number;
      user_id: number;
      pseudo: string;
      avatar_url: string | null;
    })[]
  >(
    `SELECT
      tm.team_id,
      u.id AS user_id,
      u.pseudo,
      u.avatar_url
     FROM (
       SELECT team_id, user_id, ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY joined_at ASC) as rn
       FROM bg_team_members
       WHERE left_at IS NULL
     ) limited_members
     JOIN bg_team_members tm ON tm.user_id = limited_members.user_id AND tm.team_id = limited_members.team_id
     JOIN bg_users u ON u.id = tm.user_id
     WHERE limited_members.rn <= 6
     ORDER BY tm.team_id, tm.joined_at ASC`,
  );

  // Get games practiced
  const [gameRows] = await db.execute<
    (RowDataPacket & {
      team_id: number;
      game: "OW2" | "MR";
    })[]
  >(
    `SELECT DISTINCT
      tr.team_id,
      t.game
     FROM bg_tournament_registrations tr
     JOIN bg_tournaments t ON t.id = tr.tournament_id
     ORDER BY tr.team_id, t.game`,
  );

  // Organize roster by team
  const rosterByTeam = new Map<
    number,
    { userId: number; pseudo: string; avatarUrl: string | null }[]
  >();
  for (const row of rosterRows) {
    if (!rosterByTeam.has(row.team_id)) {
      rosterByTeam.set(row.team_id, []);
    }
    rosterByTeam.get(row.team_id)!.push({
      userId: Number(row.user_id),
      pseudo: row.pseudo,
      avatarUrl: row.avatar_url,
    });
  }

  // Organize games by team
  const gamesByTeam = new Map<number, ("OW2" | "MR")[]>();
  for (const row of gameRows) {
    if (!gamesByTeam.has(row.team_id)) {
      gamesByTeam.set(row.team_id, []);
    }
    gamesByTeam.get(row.team_id)!.push(row.game);
  }

  // Transform rows and calculate rank
  const unsorted: Omit<TeamListItem, "rank">[] = teamRows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    logoUrl: row.logo_url,
    membersCount: Number(row.members_count),
    createdAt: row.created_at.toISOString(),
    wins: Number(row.wins),
    losses: Number(row.losses),
    points: Number(row.wins) * 3 + Number(row.losses) * 1,
    form: formByTeam.get(Number(row.id)) || [],
    games: gamesByTeam.get(Number(row.id)) || [],
    rosterPreview: rosterByTeam.get(Number(row.id)) || [],
    region: null,
  }));

  // Sort and assign rank
  unsorted.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.name.localeCompare(b.name, "fr");
  });

  const teams: TeamListItem[] = unsorted.map((team, index) => ({
    ...team,
    rank: index + 1,
  }));

  return teams;
}

export async function createTeam(
  ownerUserId: number,
  name: string,
  description?: string | null,
): Promise<number> {
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
      `INSERT INTO bg_teams (name, logo_url, description)
       VALUES (?, NULL, ?)`,
      [name.trim(), description?.trim() ? description.trim() : null],
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

  const [teams] = await db.execute<(RowDataPacket & { id: number; name: string; logo_url: string | null; description: string | null; created_at: Date; deleted_at: Date | null })[]>(
    `SELECT id, name, logo_url, description, created_at, deleted_at
     FROM bg_teams
     WHERE id = ?
     LIMIT 1`,
    [teamId],
  );

  if (teams.length === 0) return null;

  const isDeleted = teams[0].deleted_at !== null;

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

  // Une équipe dissoute reste consultable (stats) mais n'est plus administrable
  // ni rejoignable.
  const canManage = !isDeleted && (await userCanManageTeam(teamId, viewerUserId));

  const viewerRoles = isDeleted ? null : await getMemberRoles(teamId, viewerUserId);
  let viewerMembership: TeamDetailResponse["viewerMembership"] = "NONE";
  if (viewerRoles) {
    viewerMembership = viewerRoles.includes("OWNER") ? "OWNER" : "MEMBER";
  }

  let viewerInvitation: TeamDetailResponse["viewerInvitation"] = "NONE";
  if (!isDeleted && viewerMembership === "NONE") {
    const [inv] = await db.execute<(RowDataPacket & { kind: "INVITE" | "REQUEST" })[]>(
      `SELECT kind
       FROM bg_team_invitations
       WHERE team_id = ? AND user_id = ? AND status = 'PENDING'
       ORDER BY created_at DESC
       LIMIT 1`,
      [teamId, viewerUserId],
    );
    if (inv.length > 0) {
      viewerInvitation = inv[0].kind === "INVITE" ? "INVITED" : "REQUESTED";
    }
  }

  return {
    team: {
      id: Number(teams[0].id),
      name: teams[0].name,
      logoUrl: teams[0].logo_url,
      description: teams[0].description,
      createdAt: teams[0].created_at.toISOString(),
      deletedAt: teams[0].deleted_at ? teams[0].deleted_at.toISOString() : null,
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
    viewerMembership,
    viewerInvitation,
  };
}

export async function updateTeamMeta(
  requesterId: number,
  teamId: number,
  patch: { name?: string; description?: string | null },
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

  if (patch.description !== undefined) {
    updates.push("description = ?");
    params.push(patch.description?.trim() ? patch.description.trim() : null);
  }

  if (updates.length === 0) return;

  params.push(teamId);
  await db.execute(`UPDATE bg_teams SET ${updates.join(", ")} WHERE id = ?`, params);
}

export async function updateTeamLogo(
  requesterId: number,
  teamId: number,
  logoPath: string | null,
): Promise<void> {
  if (!(await userCanManageTeam(teamId, requesterId))) {
    throw new Error("FORBIDDEN");
  }
  const db = await getDatabase();
  await db.execute(`UPDATE bg_teams SET logo_url = ? WHERE id = ?`, [logoPath, teamId]);
}

export async function getTeamLogoUrl(teamId: number): Promise<string | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { logo_url: string | null })[]>(
    `SELECT logo_url FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  if (rows.length === 0) return null;
  return rows[0].logo_url;
}

export async function canManageTeam(teamId: number, userId: number): Promise<boolean> {
  return userCanManageTeam(teamId, userId);
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

  const requesterRoles = await getMemberRoles(teamId, requesterId);
  if (!requesterRoles) throw new Error("FORBIDDEN");
  const requesterIsOwner = requesterRoles.includes("OWNER");
  const requesterIsManager = requesterRoles.includes("MANAGER");
  if (!requesterIsOwner && !requesterIsManager) throw new Error("FORBIDDEN");

  const targetRoles = await getMemberRoles(teamId, memberUserId);
  if (!targetRoles) throw new Error("MEMBER_NOT_FOUND");
  const targetIsOwner = targetRoles.includes("OWNER");

  if (targetIsOwner && !requesterIsOwner) {
    throw new Error("FORBIDDEN");
  }

  const filteredRoles = sanitizeRoles(roles).filter((role) => role !== "OWNER");
  if (filteredRoles.length === 0) {
    throw new Error("MISSING_ROLE");
  }

  const finalRoles = targetIsOwner
    ? (["OWNER", ...filteredRoles] as TeamRole[])
    : filteredRoles;

  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE bg_team_members
     SET roles_json = ?
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL`,
    [JSON.stringify(finalRoles), teamId, memberUserId],
  );

  if (Number(res.affectedRows) === 0) {
    throw new Error("MEMBER_NOT_FOUND");
  }
}

/**
 * Exclut (kick) un membre. Autorisé aux rôles de gestion (OWNER ou MANAGER).
 * Le propriétaire ne peut pas être exclu, et nul ne peut s'exclure soi-même
 * via ce chemin (utiliser `leaveTeam`).
 */
export async function removeTeamMember(requesterId: number, teamId: number, memberUserId: number): Promise<void> {
  const db = await getDatabase();

  const requesterRoles = await getMemberRoles(teamId, requesterId);
  if (!requesterRoles) throw new Error("FORBIDDEN");
  const requesterIsOwner = requesterRoles.includes("OWNER");
  const requesterIsManager = requesterRoles.includes("MANAGER");
  if (!requesterIsOwner && !requesterIsManager) throw new Error("FORBIDDEN");

  if (memberUserId === requesterId) {
    throw new Error("OWNER_CANNOT_LEAVE");
  }

  const targetRoles = await getMemberRoles(teamId, memberUserId);
  if (!targetRoles) throw new Error("MEMBER_NOT_FOUND");
  if (targetRoles.includes("OWNER")) {
    throw new Error("CANNOT_KICK_OWNER");
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

/**
 * Un membre quitte volontairement son équipe. Le propriétaire doit d'abord
 * transférer la propriété (`transferTeamOwnership`).
 */
export async function leaveTeam(userId: number, teamId: number): Promise<void> {
  const db = await getDatabase();
  const roles = await getMemberRoles(teamId, userId);
  if (!roles) throw new Error("NOT_A_MEMBER");
  if (roles.includes("OWNER")) throw new Error("OWNER_MUST_TRANSFER");

  await db.execute(
    `UPDATE bg_team_members
     SET left_at = NOW()
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL`,
    [teamId, userId],
  );
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

export async function transferTeamOwnership(
  requesterId: number,
  teamId: number,
  newOwnerUserId: number,
): Promise<void> {
  if (requesterId === newOwnerUserId) {
    throw new Error("TRANSFER_TO_SELF");
  }

  const db = await getDatabase();

  const requesterRoles = await getMemberRoles(teamId, requesterId);
  if (!requesterRoles || !requesterRoles.includes("OWNER")) {
    throw new Error("FORBIDDEN");
  }

  const targetRoles = await getMemberRoles(teamId, newOwnerUserId);
  if (!targetRoles) {
    throw new Error("MEMBER_NOT_FOUND");
  }

  const newOwnerRoles: TeamRole[] = ["OWNER", ...targetRoles.filter((r) => r !== "OWNER")];

  const oldOwnerRemaining = requesterRoles.filter((r) => r !== "OWNER");
  const oldOwnerRoles: TeamRole[] = oldOwnerRemaining.length === 0 ? ["DPS"] : oldOwnerRemaining;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE bg_team_members
       SET roles_json = ?
       WHERE team_id = ?
         AND user_id = ?
         AND left_at IS NULL`,
      [JSON.stringify(oldOwnerRoles), teamId, requesterId],
    );

    await connection.execute(
      `UPDATE bg_team_members
       SET roles_json = ?
       WHERE team_id = ?
         AND user_id = ?
         AND left_at IS NULL`,
      [JSON.stringify(newOwnerRoles), teamId, newOwnerUserId],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function teamIsDeleted(teamId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { deleted_at: Date | null })[]>(
    `SELECT deleted_at FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  return rows.length > 0 && rows[0].deleted_at !== null;
}

/**
 * Dissout (soft-delete) une équipe : réservé au propriétaire. Les données
 * saisies par les utilisateurs (nom, description, logo) sont effacées/anonymisées
 * et les membres détachés, mais la ligne et tout l'historique généré par la
 * plateforme (inscriptions, matchs, classements) sont conservés à jamais.
 */
export async function softDeleteTeam(requesterId: number, teamId: number): Promise<void> {
  const db = await getDatabase();
  if (await teamIsDeleted(teamId)) throw new Error("TEAM_ALREADY_DELETED");
  if (!(await userOwnsTeam(teamId, requesterId))) throw new Error("FORBIDDEN");

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Anonymise les données saisies par l'utilisateur et libère le nom unique.
    await connection.execute(
      `UPDATE bg_teams
       SET deleted_at = NOW(),
           name = CONCAT('Équipe dissoute #', id),
           description = NULL,
           logo_url = NULL
       WHERE id = ?`,
      [teamId],
    );

    // Détache tous les membres encore actifs.
    await connection.execute(
      `UPDATE bg_team_members SET left_at = NOW() WHERE team_id = ? AND left_at IS NULL`,
      [teamId],
    );

    // Annule les invitations/demandes en attente.
    await connection.execute(
      `UPDATE bg_team_invitations
       SET status = 'CANCELLED', responded_at = NOW()
       WHERE team_id = ? AND status = 'PENDING'`,
      [teamId],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ───────────────────────────── Invitations & self-service ─────────────────────────────

type InvitationRow = RowDataPacket & {
  id: number;
  team_id: number;
  team_name: string;
  user_id: number;
  pseudo: string;
  kind: "INVITE" | "REQUEST";
  created_at: Date;
};

async function userHasActiveTeam(userId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_team_members WHERE user_id = ? AND left_at IS NULL LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

async function insertMembership(teamId: number, userId: number, roles: TeamRole[]): Promise<void> {
  const db = await getDatabase();
  const filtered = sanitizeRoles(roles).filter((r) => r !== "OWNER");
  const payload = filtered.length === 0 ? ["DPS"] : filtered;
  await db.execute(
    `INSERT INTO bg_team_members (team_id, user_id, roles_json) VALUES (?, ?, ?)`,
    [teamId, userId, JSON.stringify(payload)],
  );
  // Toute autre invitation/demande en attente de ce joueur devient caduque.
  await db.execute(
    `UPDATE bg_team_invitations
     SET status = 'CANCELLED', responded_at = NOW()
     WHERE user_id = ? AND status = 'PENDING'`,
    [userId],
  );
}

async function findPendingInvitation(
  teamId: number,
  userId: number,
): Promise<{ id: number; kind: "INVITE" | "REQUEST" } | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number; kind: "INVITE" | "REQUEST" })[]>(
    `SELECT id, kind FROM bg_team_invitations
     WHERE team_id = ? AND user_id = ? AND status = 'PENDING'
     ORDER BY created_at DESC LIMIT 1`,
    [teamId, userId],
  );
  return rows.length === 0 ? null : { id: Number(rows[0].id), kind: rows[0].kind };
}

/**
 * La gestion d'équipe invite un joueur (par pseudo). Remplace l'ajout forcé.
 * Si une demande (REQUEST) du joueur est déjà en attente, l'invitation la valide
 * directement et le joueur rejoint l'équipe.
 */
export async function inviteToTeam(requesterId: number, teamId: number, pseudo: string): Promise<"INVITED" | "JOINED"> {
  if (!(await userCanManageTeam(teamId, requesterId))) throw new Error("FORBIDDEN");

  const userId = await getUserIdByPseudo(pseudo);
  if (!userId) throw new Error("USER_NOT_FOUND");
  if (await userHasActiveTeam(userId)) throw new Error("USER_ALREADY_IN_TEAM");

  const existing = await findPendingInvitation(teamId, userId);
  if (existing?.kind === "REQUEST") {
    const db = await getDatabase();
    await insertMembership(teamId, userId, ["DPS"]);
    await db.execute(
      `UPDATE bg_team_invitations SET status = 'ACCEPTED', responded_at = NOW() WHERE id = ?`,
      [existing.id],
    );
    return "JOINED";
  }
  if (existing?.kind === "INVITE") throw new Error("ALREADY_INVITED");

  const db = await getDatabase();
  await db.execute(
    `INSERT INTO bg_team_invitations (team_id, user_id, created_by, kind, status)
     VALUES (?, ?, ?, 'INVITE', 'PENDING')`,
    [teamId, userId, requesterId],
  );
  return "INVITED";
}

/**
 * Un joueur demande à rejoindre une équipe (self-service). Si une invitation
 * (INVITE) lui est déjà adressée, la demande la valide et il rejoint directement.
 */
export async function requestToJoinTeam(userId: number, teamId: number): Promise<"REQUESTED" | "JOINED"> {
  if (await userHasActiveTeam(userId)) throw new Error("USER_ALREADY_IN_TEAM");

  const db = await getDatabase();
  const [teams] = await db.execute<(RowDataPacket & { id: number; deleted_at: Date | null })[]>(
    `SELECT id, deleted_at FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  if (teams.length === 0) throw new Error("TEAM_NOT_FOUND");
  if (teams[0].deleted_at !== null) throw new Error("TEAM_DELETED");

  const existing = await findPendingInvitation(teamId, userId);
  if (existing?.kind === "INVITE") {
    await insertMembership(teamId, userId, ["DPS"]);
    await db.execute(
      `UPDATE bg_team_invitations SET status = 'ACCEPTED', responded_at = NOW() WHERE id = ?`,
      [existing.id],
    );
    return "JOINED";
  }
  if (existing?.kind === "REQUEST") throw new Error("ALREADY_REQUESTED");

  await db.execute(
    `INSERT INTO bg_team_invitations (team_id, user_id, created_by, kind, status)
     VALUES (?, ?, ?, 'REQUEST', 'PENDING')`,
    [teamId, userId, userId],
  );
  return "REQUESTED";
}

/**
 * Répond à une invitation/demande en attente.
 * - INVITE : seul le joueur invité (user_id) peut répondre.
 * - REQUEST : seule la gestion de l'équipe peut répondre.
 */
export async function respondToInvitation(
  actingUserId: number,
  invitationId: number,
  accept: boolean,
): Promise<void> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { team_id: number; user_id: number; kind: "INVITE" | "REQUEST"; status: string })[]>(
    `SELECT team_id, user_id, kind, status FROM bg_team_invitations WHERE id = ? LIMIT 1`,
    [invitationId],
  );
  if (rows.length === 0) throw new Error("INVITATION_NOT_FOUND");
  const inv = rows[0];
  if (inv.status !== "PENDING") throw new Error("INVITATION_NOT_PENDING");

  if (inv.kind === "INVITE") {
    if (Number(inv.user_id) !== actingUserId) throw new Error("FORBIDDEN");
  } else {
    if (!(await userCanManageTeam(Number(inv.team_id), actingUserId))) throw new Error("FORBIDDEN");
  }

  if (!accept) {
    await db.execute(
      `UPDATE bg_team_invitations SET status = 'DECLINED', responded_at = NOW() WHERE id = ?`,
      [invitationId],
    );
    return;
  }

  if (await userHasActiveTeam(Number(inv.user_id))) throw new Error("USER_ALREADY_IN_TEAM");
  await insertMembership(Number(inv.team_id), Number(inv.user_id), ["DPS"]);
  await db.execute(
    `UPDATE bg_team_invitations SET status = 'ACCEPTED', responded_at = NOW() WHERE id = ?`,
    [invitationId],
  );
}

/** Invitations (INVITE) en attente adressées au joueur. */
export async function listUserInvitations(userId: number): Promise<
  { id: number; teamId: number; teamName: string; kind: "INVITE" | "REQUEST"; createdAt: string }[]
> {
  const db = await getDatabase();
  const [rows] = await db.execute<InvitationRow[]>(
    `SELECT i.id, i.team_id, t.name AS team_name, i.user_id, u.pseudo, i.kind, i.created_at
     FROM bg_team_invitations i
     JOIN bg_teams t ON t.id = i.team_id
     JOIN bg_users u ON u.id = i.user_id
     WHERE i.user_id = ? AND i.kind = 'INVITE' AND i.status = 'PENDING'
     ORDER BY i.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    teamId: Number(r.team_id),
    teamName: r.team_name,
    kind: r.kind,
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
  }));
}

/** Demandes (REQUEST) en attente pour une équipe (vue gestion). */
export async function listTeamJoinRequests(
  teamId: number,
  requesterId: number,
): Promise<{ id: number; userId: number; pseudo: string; createdAt: string }[]> {
  if (!(await userCanManageTeam(teamId, requesterId))) throw new Error("FORBIDDEN");
  const db = await getDatabase();
  const [rows] = await db.execute<InvitationRow[]>(
    `SELECT i.id, i.team_id, t.name AS team_name, i.user_id, u.pseudo, i.kind, i.created_at
     FROM bg_team_invitations i
     JOIN bg_teams t ON t.id = i.team_id
     JOIN bg_users u ON u.id = i.user_id
     WHERE i.team_id = ? AND i.kind = 'REQUEST' AND i.status = 'PENDING'
     ORDER BY i.created_at DESC`,
    [teamId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    userId: Number(r.user_id),
    pseudo: r.pseudo,
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
  }));
}

