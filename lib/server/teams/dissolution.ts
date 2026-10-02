import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import { ghostAdminOverride, lockMemberRoles, userOwnsTeam } from "./access";

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
 * saisies par les utilisateurs (nom, description, logo — fichier compris, s'il
 * n'est plus désigné ailleurs) sont effacées/anonymisées
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
  const viaOwnership = await userOwnsTeam(teamId, requesterId);
  if (!viaOwnership && !(await ghostAdminOverride(teamId, viewerManagesGhostTeams))) {
    throw new Error("FORBIDDEN");
  }

  let previousLogoUrl: string | null = null;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Le logo est relu sous verrou, en toute première instruction : c'est le
    // fichier que la dissolution retire, et il n'est effacé qu'après le commit.
    // Ce verrou est celui des gestes du roster (`withTeamRosterLock`) : le droit
    // de dissoudre est donc **rejugé** dessous — lu seulement avant, un vieil
    // onglet de l'ancien propriétaire dissolvait l'équipe qu'il venait de
    // transférer, et le staff une fantôme reprise entre-temps.
    const [locked] = await connection.execute<
      (RowDataPacket & { logo_url: string | null; deleted_at: Date | null; is_ghost: 0 | 1 })[]
    >(
      `SELECT logo_url, deleted_at, is_ghost FROM bg_teams WHERE id = ? FOR UPDATE`,
      [teamId],
    );
    if (locked.length === 0) throw new Error("FORBIDDEN");
    if (locked[0].deleted_at) throw new Error("TEAM_ALREADY_DELETED");
    if (viaOwnership) {
      const roles = await lockMemberRoles(connection, teamId, requesterId);
      if (!roles?.includes("OWNER")) throw new Error("FORBIDDEN");
    } else if (locked[0].is_ghost !== 1) {
      throw new Error("FORBIDDEN");
    }
    previousLogoUrl = locked[0].logo_url ?? null;

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

  // Vider la colonne ne retirait pas l'image : le fichier restait servi par
  // `/api/uploads/teams/…`, en cache public d'un an. Après le commit (un
  // `unlink` ne se défait pas), et seulement s'il vit dans `teams/` et que plus
  // aucune ligne ne le désigne — un logo partagé reste à qui le porte encore.
  await deleteUnreferencedUpload(previousLogoUrl, "teams");
}
