import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import type { TeamDetailResponse, TeamListItem, TeamMember, TeamRole } from "@/lib/shared/types";
import { getUserIdByPseudo, sanitizeRoles } from "@/lib/server/users-service";
import { getTeamEntityStats } from "@/lib/server/stats-service";
import { getTeamRankingPosition, loadTeamRanking } from "@/lib/server/ranking-service";
import { compareRankedTeams, rankingMatchJoinSql } from "@/lib/shared/ranking";
import { assertTeamTagAvailable, mapTeamTagConflict, resolveTeamTag } from "@/lib/server/team-tags";

/**
 * Longueur de la barre de forme des cartes d'annuaire. Les fiches en montrent
 * moins (`FORM_LENGTH` de `lib/shared/stats.ts`) : c'est le même historique,
 * lu sur une fenêtre plus courte, jamais un autre calcul.
 */
const LIST_FORM_LENGTH = 10;

type TeamMemberRow = RowDataPacket & {
  membership_id: number;
  user_id: number;
  pseudo: string;
  avatar_url: string | null;
  roles_json: string;
  joined_at: Date;
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

/**
 * Vrai si l'équipe est une équipe fantôme (créée par le staff, sans joueur).
 * Une équipe dissoute n'est plus administrable, fantôme ou non.
 */
export async function isGhostTeam(teamId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { is_ghost: 0 | 1; deleted_at: Date | null })[]>(
    `SELECT is_ghost, deleted_at FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  return rows.length > 0 && rows[0].is_ghost === 1 && rows[0].deleted_at === null;
}

/**
 * Autorisation d'administration d'une équipe. Deux voies :
 * - être OWNER (ou MANAGER selon l'action) de l'équipe ;
 * - disposer de la permission `tournaments` **et** viser une équipe fantôme.
 *
 * `viewerManagesGhostTeams` est fourni par la route API, seule à connaître les
 * rôles de plateforme du viewer.
 */
async function ghostAdminOverride(teamId: number, viewerManagesGhostTeams: boolean): Promise<boolean> {
  if (!viewerManagesGhostTeams) return false;
  return isGhostTeam(teamId);
}

export async function listTeams(): Promise<TeamListItem[]> {
  const db = await getDatabase();

  // Effectif et identité de chaque équipe. Le bilan (victoires, défaites,
  // points) ne se calcule **pas** ici : il vient de `loadTeamRanking`, source
  // unique du classement du site. L'agréger dans cette requête revenait à le
  // multiplier par l'effectif de l'équipe — la jointure des membres et celle
  // des matchs formaient un produit cartésien, et une équipe de six joueurs
  // affichait six fois ses victoires.
  const [teamRows] = await db.execute<
    (RowDataPacket & {
      id: number;
      name: string;
      tag: string | null;
      logo_url: string | null;
      created_at: Date;
      members_count: number;
      is_ghost: 0 | 1;
    })[]
  >(
    `SELECT
      t.id,
      t.name,
      t.tag,
      t.logo_url,
      t.created_at,
      t.is_ghost,
      COALESCE(COUNT(tm.id), 0) AS members_count
     FROM bg_teams t
     LEFT JOIN bg_team_members tm ON tm.team_id = t.id AND tm.left_at IS NULL
     WHERE t.deleted_at IS NULL
       AND t.solo_user_id IS NULL
     GROUP BY t.id, t.name, t.tag, t.logo_url, t.created_at, t.is_ghost`,
  );

  // Forme : les dix derniers résultats de chaque équipe, le plus récent en
  // tête. Même assiette de matchs que le bilan (`playedMatchSql`) et même
  // chronologie que les fiches (`updated_at`, à défaut les dates du tournoi) :
  // la barre de forme de la carte est le début de celle de la fiche, pas une
  // autre lecture des mêmes matchs. Le découpage par équipe se fait en SQL, ce
  // qui évite aussi de ne servir que les 1000 derniers matchs du site — au-delà,
  // les équipes les moins actives n'avaient plus de forme du tout.
  const [formRows] = await db.execute<
    (RowDataPacket & { team_id: number; result: "w" | "l" })[]
  >(
    `SELECT team_id, result
     FROM (
       SELECT
         t.id AS team_id,
         CASE WHEN m.winner_team_id = t.id THEN 'w' ELSE 'l' END AS result,
         ROW_NUMBER() OVER (
           PARTITION BY t.id
           ORDER BY COALESCE(m.updated_at, tr.finished_at, tr.start_at) DESC, m.id DESC
         ) AS rn
       FROM bg_teams t
       JOIN bg_matches m
         ON ${rankingMatchJoinSql("t.id")}
       JOIN bg_tournaments tr ON tr.id = m.tournament_id
       WHERE t.deleted_at IS NULL
         AND t.solo_user_id IS NULL
     ) ranked
     WHERE rn <= ${LIST_FORM_LENGTH}
     ORDER BY team_id ASC, rn ASC`,
  );

  const formByTeam = new Map<number, ("w" | "l" | "d")[]>();
  for (const row of formRows) {
    const teamId = Number(row.team_id);
    const form = formByTeam.get(teamId) ?? [];
    form.push(row.result);
    formByTeam.set(teamId, form);
  }

  // Bilan et points : une seule source pour l'annuaire, la fiche et le
  // leaderboard de la landing.
  const rankingByTeam = new Map(
    (await loadTeamRanking({ includeUnplayed: true })).map((row) => [row.teamId, row]),
  );

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
  const unsorted: Omit<TeamListItem, "rank">[] = teamRows.map((row) => {
    const id = Number(row.id);
    const ranked = rankingByTeam.get(id);
    return {
      id,
      name: row.name,
      tag: row.tag,
      logoUrl: row.logo_url,
      membersCount: Number(row.members_count),
      createdAt: toIso(row.created_at)!,
      wins: ranked?.wins ?? 0,
      losses: ranked?.losses ?? 0,
      points: ranked?.points ?? 0,
      form: formByTeam.get(id) || [],
      games: gamesByTeam.get(id) || [],
      rosterPreview: rosterByTeam.get(id) || [],
      region: null,
      isGhost: row.is_ghost === 1,
    };
  });

  // Même ordre que le leaderboard de la landing : les classées d'abord, puis la
  // cote, les victoires et le nom. `TeamListItem` porte les quatre champs que
  // `compareRankedTeams` lit, donc la carte se trie avec la règle unique.
  unsorted.sort(compareRankedTeams);

  const teams: TeamListItem[] = unsorted.map((team, index) => ({
    ...team,
    rank: index + 1,
  }));

  return teams;
}

/**
 * Crée une équipe et en fait son auteur OWNER.
 *
 * Le sigle est facultatif (`null` = pas de sigle). Sa forme est validée avant
 * toute écriture, son unicité vérifiée dans la transaction — et rattrapée par
 * l'index unique si une création concurrente a pris le même entre-temps.
 */
export async function createTeam(
  ownerUserId: number,
  name: string,
  description?: string | null,
  tag?: string | null,
): Promise<number> {
  const db = await getDatabase();
  const normalizedTag = resolveTeamTag(tag);

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

    await assertTeamTagAvailable(connection, normalizedTag);

    const [teamInsert] = await mapTeamTagConflict(() =>
      connection.execute<ResultSetHeader>(
        `INSERT INTO bg_teams (name, tag, logo_url, description)
         VALUES (?, ?, NULL, ?)`,
        [name.trim(), normalizedTag, description?.trim() ? description.trim() : null],
      ));

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

/**
 * Détail d'une équipe.
 *
 * `viewerManagesGhostTeams` = le viewer dispose de la permission `tournaments`.
 * Il administre alors les équipes **fantômes** (sans joueur rattaché) sans en
 * être membre ; ça ne lui donne aucun droit sur les équipes réelles.
 */
/**
 * Fiche complète d'une équipe.
 *
 * @param includeRanking calcule la place au classement du site. Coûteux — il
 *   faut agréger toutes les équipes — donc réservé à la consultation de la
 *   fiche : les routes de mutation reconstruisent la réponse sans classement.
 */
export async function getTeamDetail(
  teamId: number,
  viewerUserId: number,
  viewerManagesGhostTeams = false,
  includeRanking = false,
): Promise<TeamDetailResponse | null> {
  const db = await getDatabase();

  const [teams] = await db.execute<(RowDataPacket & { id: number; name: string; tag: string | null; logo_url: string | null; description: string | null; created_at: Date; deleted_at: Date | null; is_ghost: 0 | 1; solo_user_id: number | null })[]>(
    `SELECT id, name, tag, logo_url, description, created_at, deleted_at, is_ghost, solo_user_id
     FROM bg_teams
     WHERE id = ?
     LIMIT 1`,
    [teamId],
  );

  // Une entrée solo occupe une ligne de `bg_teams` mais représente un joueur :
  // elle n'a pas de fiche d'équipe, son identité publique est son profil.
  if (teams.length === 0 || teams[0].solo_user_id !== null) return null;

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

  // Statistiques et historique proviennent de la même collecte : le bilan de
  // chaque ligne ne peut donc pas contredire l'agrégat affiché au-dessus.
  const [{ stats, tournaments }, ranking] = await Promise.all([
    getTeamEntityStats(teamId),
    includeRanking ? getTeamRankingPosition(teamId) : Promise.resolve(null),
  ]);

  const isGhost = teams[0].is_ghost === 1;

  // Une équipe dissoute reste consultable (stats) mais n'est plus administrable
  // ni rejoignable.
  const managedAsGhost = !isDeleted && isGhost && viewerManagesGhostTeams;
  const canManage = !isDeleted && (managedAsGhost || (await userCanManageTeam(teamId, viewerUserId)));

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
      tag: teams[0].tag,
      logoUrl: teams[0].logo_url,
      description: teams[0].description,
      createdAt: toIso(teams[0].created_at)!,
      deletedAt: toIso(teams[0].deleted_at),
      isGhost,
    },
    members: membersRows.map(mapMember),
    tournaments,
    stats,
    ranking,
    canManage,
    managedAsGhost,
    viewerMembership,
    viewerInvitation,
  };
}

/**
 * Met à jour les métadonnées d'une équipe. Un champ absent du patch n'est pas
 * touché ; `tag: null` (ou une chaîne vide) **retire** le sigle.
 */
export async function updateTeamMeta(
  requesterId: number,
  teamId: number,
  patch: { name?: string; description?: string | null; tag?: string | null },
  viewerManagesGhostTeams = false,
): Promise<void> {
  const db = await getDatabase();
  if (
    !(await userOwnsTeam(teamId, requesterId))
    && !(await ghostAdminOverride(teamId, viewerManagesGhostTeams))
  ) {
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

  if (patch.tag !== undefined) {
    const normalizedTag = resolveTeamTag(patch.tag);
    // L'équipe garde le sien : sans cette exclusion, réenregistrer la fiche
    // sans toucher au sigle le déclarerait pris par elle-même.
    await assertTeamTagAvailable(db, normalizedTag, teamId);
    updates.push("tag = ?");
    params.push(normalizedTag);
  }

  if (updates.length === 0) return;

  params.push(teamId);
  await mapTeamTagConflict(() =>
    db.execute(`UPDATE bg_teams SET ${updates.join(", ")} WHERE id = ?`, params));
}

export async function updateTeamLogo(
  requesterId: number,
  teamId: number,
  logoPath: string | null,
  viewerManagesGhostTeams = false,
): Promise<void> {
  if (
    !(await userCanManageTeam(teamId, requesterId))
    && !(await ghostAdminOverride(teamId, viewerManagesGhostTeams))
  ) {
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

/**
 * Équipe active d'un joueur (une seule, invariant du projet).
 *
 * @param connection Connexion sur laquelle lire. **À fournir dès que l'appelant
 *   est dans une transaction** : sans elle, la fonction emprunte une *seconde*
 *   place du pool (25) alors que la première est retenue par la transaction. Un
 *   appelant qui tient en plus un verrou de ligne — l'inscription retient celle
 *   du tournoi — arme alors un convoi : le porteur du verrou attend une
 *   connexion que les transactions bloquées sur son verrou ne rendront pas, et
 *   rien ne se dénoue avant `innodb_lock_wait_timeout`.
 */
export async function getUserActiveTeam(
  userId: number,
  connection?: Pick<PoolConnection, "execute">,
): Promise<{ teamId: number; teamName: string } | null> {
  const db = connection ?? (await getDatabase());
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
export async function softDeleteTeam(
  requesterId: number,
  teamId: number,
  viewerManagesGhostTeams = false,
): Promise<void> {
  const db = await getDatabase();
  if (await teamIsDeleted(teamId)) throw new Error("TEAM_ALREADY_DELETED");
  if (
    !(await userOwnsTeam(teamId, requesterId))
    && !(await ghostAdminOverride(teamId, viewerManagesGhostTeams))
  ) {
    throw new Error("FORBIDDEN");
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Anonymise les données saisies par l'utilisateur et libère les deux
    // identités uniques : le nom **et le sigle**. Le sigle vaut sur tout le
    // site ; laissé sur une équipe dissoute, il resterait pris à jamais par une
    // équipe qui n'existe plus — la ligne, elle, survit pour ses statistiques.
    await connection.execute(
      `UPDATE bg_teams
       SET deleted_at = NOW(),
           name = CONCAT('Équipe dissoute #', id),
           tag = NULL,
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

