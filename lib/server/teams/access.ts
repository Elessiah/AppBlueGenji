import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase, type SqlParams } from "@/lib/server/database";
import { parseRoles } from "@/lib/server/serialization";
import type { TeamRole } from "@/lib/shared/types";
import { hasTeamManagementRole } from "@/lib/shared/team-roles";
import { assertTermsAccepted } from "@/lib/server/terms-acceptance";

/*
 * Droits sur une équipe et verrous du roster : rôles d'un membre, dérogation
 * du staff sur une équipe fantôme, transaction sérialisée sur la ligne de
 * l'équipe. Partagé par tous les gestes d'équipe.
 */

export async function userOwnsTeam(teamId: number, userId: number): Promise<boolean> {
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

export async function getMemberRoles(teamId: number, userId: number): Promise<TeamRole[] | null> {
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

/**
 * Transaction d'une écriture sur le roster d'une équipe existante (rôles,
 * propriété, départ, exclusion).
 *
 * Ces gestes lisaient les rôles sur le pool puis écrivaient sans rien relire :
 * un destinataire parti entre les deux ne recevait pas la propriété que
 * l'ancien propriétaire venait de perdre, et l'équipe restait sans `OWNER`. Ils
 * se sérialisent désormais sur **la ligne de l'équipe**, verrouillée en
 * exclusif — la même que prennent la dissolution (`softDeleteTeam`) et, en
 * partagé, l'acceptation (`acceptIntoTeam`), toujours **après** une éventuelle
 * ligne de joueur : c'est l'ordre établi, qui interdit l'interblocage.
 *
 * @param lockUserId compte à verrouiller **avant** l'équipe — en toute première
 *   instruction, comme le fait `acceptIntoTeam` ; sans lui, le verrou de
 *   l'équipe est la première instruction. Sous REPEATABLE READ, c'est la
 *   première lecture ordinaire qui fige l'instantané : toute relecture des
 *   rôles vient donc après le verrou, par {@link lockMemberRoles}.
 */
export async function withTeamRosterLock<T>(
  teamId: number,
  work: (connection: PoolConnection) => Promise<T>,
  lockUserId?: (connection: PoolConnection) => Promise<void>,
): Promise<T> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (lockUserId) await lockUserId(connection);
    await connection.execute(`SELECT id FROM bg_teams WHERE id = ? FOR UPDATE`, [teamId]);
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Rôles en cours d'un membre, relus **sous verrou** dans la transaction. */
export async function lockMemberRoles(
  connection: Pick<PoolConnection, "execute">,
  teamId: number,
  userId: number,
): Promise<TeamRole[] | null> {
  const [rows] = await connection.execute<(RowDataPacket & { roles_json: string })[]>(
    `SELECT roles_json
     FROM bg_team_members
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL
     LIMIT 1
     FOR UPDATE`,
    [teamId, userId],
  );
  if (rows.length === 0) return null;
  return parseRoles(rows[0].roles_json);
}

/**
 * Écrit sur **une** ligne d'appartenance en cours, et refuse si l'écriture n'en
 * apparie pas exactement une : sous les verrous de {@link withTeamRosterLock},
 * c'est impossible — le contrôle garde la règle si ce verrou venait à manquer,
 * au lieu d'un `UPDATE` muet qui laisserait le roster à moitié écrit.
 */
export async function writeActiveMembership(
  connection: Pick<PoolConnection, "execute">,
  setSql: string,
  params: SqlParams,
  teamId: number,
  userId: number,
): Promise<void> {
  const [res] = await connection.execute<ResultSetHeader>(
    `UPDATE bg_team_members
     SET ${setSql}
     WHERE team_id = ?
       AND user_id = ?
       AND left_at IS NULL`,
    [...params, teamId, userId],
  );
  if (Number(res.affectedRows) !== 1) throw new Error("MEMBER_NOT_FOUND");
}

export async function userCanManageTeam(teamId: number, userId: number): Promise<boolean> {
  return hasTeamManagementRole(await getMemberRoles(teamId, userId));
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
export async function ghostAdminOverride(teamId: number, viewerManagesGhostTeams: boolean): Promise<boolean> {
  if (!viewerManagesGhostTeams) return false;
  return isGhostTeam(teamId);
}

/**
 * Le droit d'agir sur une équipe au titre de sa gestion **ou** de la dérogation
 * du staff sur une fantôme — puis les conditions d'utilisation
 * (`lib/shared/terms-of-use.ts`), exigées de qui gère **son** équipe et
 * jamais du staff sur une fantôme : c'est alors l'association elle-même qui
 * conduit l'équipe.
 *
 * La dérogation n'est interrogée que si le rôle manque, comme avant : un
 * gérant ne paie pas la lecture de l'équipe.
 *
 * @throws FORBIDDEN
 * @throws TERMS_ACCEPTANCE_REQUIRED
 */
export async function assertCanActOnTeam(
  hasRole: boolean,
  requesterId: number,
  teamId: number,
  viewerManagesGhostTeams: boolean,
  requireTerms = true,
): Promise<void> {
  if (hasRole) {
    if (requireTerms) await assertTermsAccepted(requesterId);
    return;
  }
  if (!(await ghostAdminOverride(teamId, viewerManagesGhostTeams))) throw new Error("FORBIDDEN");
}

export async function canManageTeam(teamId: number, userId: number): Promise<boolean> {
  return userCanManageTeam(teamId, userId);
}
