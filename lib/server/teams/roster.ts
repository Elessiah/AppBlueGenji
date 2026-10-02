import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { parseRoles } from "@/lib/server/serialization";
import type { TeamRole } from "@/lib/shared/types";
import { sanitizeRoles } from "@/lib/server/users/roles";
import { assertTermsAccepted } from "@/lib/server/terms-acceptance";
import { lockMemberRoles, withTeamRosterLock, writeActiveMembership } from "./access";

/*
 * Roster d'une équipe en place : rôles des membres, exclusion, départ,
 * transfert de propriété, et l'équipe active d'un joueur.
 */

/**
 * Change les rôles d'un membre. Autorisé aux rôles de gestion (OWNER ou
 * MANAGER) ; un MANAGER ne touche pas aux rôles de l'OWNER.
 *
 * Rôles du demandeur **et** de la cible relus sous le verrou de l'équipe
 * (`withTeamRosterLock`) : lu avant, un `targetIsOwner` périmé réécrivait sans
 * `OWNER` les rôles d'un membre qui venait de recevoir la propriété, et
 * l'équipe restait sans propriétaire.
 */
export async function updateTeamMemberRoles(
  requesterId: number,
  teamId: number,
  memberUserId: number,
  roles: TeamRole[],
): Promise<void> {
  await withTeamRosterLock(teamId, async (connection) => {
    const requesterRoles = await lockMemberRoles(connection, teamId, requesterId);
    if (!requesterRoles) throw new Error("FORBIDDEN");
    const requesterIsOwner = requesterRoles.includes("OWNER");
    const requesterIsManager = requesterRoles.includes("MANAGER");
    if (!requesterIsOwner && !requesterIsManager) throw new Error("FORBIDDEN");
    await assertTermsAccepted(requesterId, connection);

    const targetRoles = await lockMemberRoles(connection, teamId, memberUserId);
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

    await writeActiveMembership(
      connection,
      "roles_json = ?",
      [JSON.stringify(finalRoles)],
      teamId,
      memberUserId,
    );
  });
}

/**
 * Exclut (kick) un membre. Autorisé aux rôles de gestion (OWNER ou MANAGER).
 * Le propriétaire ne peut pas être exclu, et nul ne peut s'exclure soi-même
 * via ce chemin (utiliser `leaveTeam`).
 *
 * Sous le verrou de l'équipe, comme le transfert : lu avant, un membre qui
 * recevait la propriété entre la lecture et l'écriture était exclu malgré
 * `CANNOT_KICK_OWNER`, emportant le seul `OWNER` de l'équipe.
 */
export async function removeTeamMember(requesterId: number, teamId: number, memberUserId: number): Promise<void> {
  await withTeamRosterLock(teamId, async (connection) => {
    const requesterRoles = await lockMemberRoles(connection, teamId, requesterId);
    if (!requesterRoles) throw new Error("FORBIDDEN");
    const requesterIsOwner = requesterRoles.includes("OWNER");
    const requesterIsManager = requesterRoles.includes("MANAGER");
    if (!requesterIsOwner && !requesterIsManager) throw new Error("FORBIDDEN");
    await assertTermsAccepted(requesterId, connection);

    if (memberUserId === requesterId) {
      throw new Error("OWNER_CANNOT_LEAVE");
    }

    const targetRoles = await lockMemberRoles(connection, teamId, memberUserId);
    if (!targetRoles) throw new Error("MEMBER_NOT_FOUND");
    if (targetRoles.includes("OWNER")) {
      throw new Error("CANNOT_KICK_OWNER");
    }

    await writeActiveMembership(connection, "left_at = NOW()", [], teamId, memberUserId);
  });
}

/**
 * Un membre quitte volontairement son équipe. Le propriétaire doit d'abord
 * transférer la propriété (`transferTeamOwnership`).
 *
 * Sous le verrou de l'équipe : lu avant, un membre qui recevait la propriété
 * pendant son départ partait avec, et l'équipe restait sans propriétaire.
 */
export async function leaveTeam(userId: number, teamId: number): Promise<void> {
  await withTeamRosterLock(teamId, async (connection) => {
    const roles = await lockMemberRoles(connection, teamId, userId);
    if (!roles) throw new Error("NOT_A_MEMBER");
    if (roles.includes("OWNER")) throw new Error("OWNER_MUST_TRANSFER");

    await writeActiveMembership(connection, "left_at = NOW()", [], teamId, userId);
  });
}

/**
 * Équipe active d'un joueur (une seule, invariant du projet), **avec les rôles
 * qu'il y porte**.
 *
 * Les rôles voyagent avec l'équipe, et pas par un second appel : ils vivent sur
 * la ligne d'appartenance déjà lue, et l'appelant qui en a besoin est justement
 * celui qui ne peut pas se permettre une requête de plus — l'inscription les lit
 * sous le verrou du tournoi (voir `connection` ci-dessous).
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
): Promise<{ teamId: number; teamName: string; roles: TeamRole[] } | null> {
  const db = connection ?? (await getDatabase());
  const [rows] = await db.execute<
    (RowDataPacket & { team_id: number; team_name: string; roles_json: string })[]
  >(
    `SELECT tm.team_id, t.name AS team_name, tm.roles_json
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
    roles: parseRoles(rows[0].roles_json),
  };
}

/**
 * Transfère la propriété (`OWNER`) à un autre membre en cours de l'équipe.
 *
 * Tout se joue dans une transaction : compte du destinataire verrouillé en
 * toute première instruction (le verrou que prend la suppression de compte),
 * puis la ligne de l'équipe (`withTeamRosterLock`), puis les rôles des deux
 * membres **relus** sous ces verrous. Lus sur le pool, ils laissaient deux
 * issues : un destinataire parti entre la lecture et l'écriture ne recevait
 * rien pendant que l'ancien propriétaire perdait le rôle (équipe sans
 * `OWNER`, que le staff ne peut pas réparer sur une équipe réelle), et deux
 * transferts simultanés vers deux membres laissaient deux `OWNER`. Chaque
 * écriture doit en outre apparier exactement une ligne, sans quoi tout est
 * défait.
 */
export async function transferTeamOwnership(
  requesterId: number,
  teamId: number,
  newOwnerUserId: number,
): Promise<void> {
  if (requesterId === newOwnerUserId) {
    throw new Error("TRANSFER_TO_SELF");
  }

  let targetDeleted = false;
  await withTeamRosterLock(
    teamId,
    async (connection) => {
      const requesterRoles = await lockMemberRoles(connection, teamId, requesterId);
      if (!requesterRoles?.includes("OWNER")) {
        throw new Error("FORBIDDEN");
      }
      await assertTermsAccepted(requesterId, connection);

      const targetRoles = await lockMemberRoles(connection, teamId, newOwnerUserId);
      if (!targetRoles) {
        throw new Error("MEMBER_NOT_FOUND");
      }
      // Un compte anonymisé garde sa ligne d'appartenance : lui confier
      // l'équipe la laisserait sans personne capable d'ouvrir une session pour
      // la conduire, et l'état serait définitif — seul le propriétaire
      // transfère ou dissout, et il ne peut être ni exclu ni partir.
      if (targetDeleted) throw new Error("MEMBER_ACCOUNT_DELETED");

      const newOwnerRoles: TeamRole[] = ["OWNER", ...targetRoles.filter((r) => r !== "OWNER")];
      const oldOwnerRemaining = requesterRoles.filter((r) => r !== "OWNER");
      const oldOwnerRoles: TeamRole[] = oldOwnerRemaining.length === 0 ? ["DPS"] : oldOwnerRemaining;

      await writeActiveMembership(
        connection,
        "roles_json = ?",
        [JSON.stringify(oldOwnerRoles)],
        teamId,
        requesterId,
      );
      await writeActiveMembership(
        connection,
        "roles_json = ?",
        [JSON.stringify(newOwnerRoles)],
        teamId,
        newOwnerUserId,
      );
    },
    async (connection) => {
      const [targetAccount] = await connection.execute<(RowDataPacket & { is_deleted: 0 | 1 })[]>(
        `SELECT is_deleted FROM bg_users WHERE id = ? FOR UPDATE`,
        [newOwnerUserId],
      );
      targetDeleted = targetAccount.length === 0 || targetAccount[0].is_deleted === 1;
    },
  );
}
