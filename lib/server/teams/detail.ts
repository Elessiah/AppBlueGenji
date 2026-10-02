import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import type { TeamDetailResponse, TeamMember } from "@/lib/shared/types";
import { getTeamEntityStats } from "@/lib/server/stats-service";
import { getTeamRankingPosition } from "@/lib/server/ranking-service";
import { visibleAvatarUrl } from "@/lib/shared/avatar";
import { localUploadUrl } from "@/lib/shared/uploads";
import type { TeamPageIdentity } from "@/lib/shared/entity-page-titles";
import { getMemberRoles, userCanManageTeam } from "./access";

type TeamMemberRow = RowDataPacket & {
  membership_id: number;
  user_id: number;
  pseudo: string;
  avatar_url: string | null;
  visible_avatar: 0 | 1;
  is_deleted: 0 | 1;
  roles_json: string;
  joined_at: Date;
};

/**
 * @param viewerUserId Lecteur du roster, pour qu'il continue de voir son propre
 *   avatar même masqué au reste du site (`visibleAvatarUrl`).
 */
function mapMember(row: TeamMemberRow, viewerUserId: number | null): TeamMember {
  const userId = Number(row.user_id);
  return {
    membershipId: Number(row.membership_id),
    userId,
    pseudo: row.pseudo,
    avatarUrl: visibleAvatarUrl(
      row.avatar_url,
      row.visible_avatar === 1,
      userId === viewerUserId,
    ),
    roles: parseRoles(row.roles_json),
    joinedAt: toIso(row.joined_at) ?? new Date().toISOString(),
    isDeleted: row.is_deleted === 1,
  };
}

/**
 * Ce que l'onglet d'une fiche d'équipe a le droit de nommer — le nom, et rien
 * d'autre. Lecture d'une ligne, sans les membres ni les statistiques de
 * {@link getTeamDetail} : elle sert à `generateMetadata`, jouée à chaque
 * ouverture de la fiche en plus de la lecture de la page.
 *
 * Une entrée solo rend `null`, comme `getTeamDetail` : c'est un joueur, sa
 * fiche est son profil. Une équipe dissoute garde son nom, sa fiche aussi.
 */
export async function getTeamPageIdentity(teamId: number): Promise<TeamPageIdentity | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { name: string })[]>(
    `SELECT name FROM bg_teams WHERE id = ? AND solo_user_id IS NULL LIMIT 1`,
    [teamId],
  );
  return rows.length === 0 ? null : { name: rows[0].name };
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
      u.visible_avatar,
      u.is_deleted,
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
  let viewerInvitationId: number | null = null;
  if (!isDeleted && viewerMembership === "NONE") {
    const [inv] = await db.execute<(RowDataPacket & { id: number; kind: "INVITE" | "REQUEST" })[]>(
      `SELECT id, kind
       FROM bg_team_invitations
       WHERE team_id = ? AND user_id = ? AND status = 'PENDING'
       ORDER BY created_at DESC
       LIMIT 1`,
      [teamId, viewerUserId],
    );
    if (inv.length > 0) {
      viewerInvitation = inv[0].kind === "INVITE" ? "INVITED" : "REQUESTED";
      viewerInvitationId = Number(inv[0].id);
    }
  }

  return {
    team: {
      id: Number(teams[0].id),
      name: teams[0].name,
      tag: teams[0].tag,
      logoUrl: localUploadUrl(teams[0].logo_url),
      description: teams[0].description,
      createdAt: toIso(teams[0].created_at)!,
      deletedAt: toIso(teams[0].deleted_at),
      isGhost,
    },
    members: membersRows.map((row) => mapMember(row, viewerUserId)),
    tournaments,
    stats,
    ranking,
    canManage,
    managedAsGhost,
    viewerUserId,
    viewerMembership,
    viewerInvitation,
    viewerInvitationId,
  };
}
