import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase, type SqlParams } from "@/lib/server/database";
import {
  assertTeamNameAvailable,
  assertTeamTagAvailable,
  isTeamNameConflict,
  mapTeamTagConflict,
  resolveTeamTag,
} from "@/lib/server/team-tags";
import { checkTeamName, TEAM_NAME_ALREADY_USED } from "@/lib/shared/team-name";
import { recordTermsAcceptance } from "@/lib/server/terms-acceptance";
import { assertCanActOnTeam, userCanManageTeam, userOwnsTeam } from "./access";

/*
 * Identité d'une équipe : création, nom, sigle et description, logo (par la
 * gestion de l'équipe ou par la modération).
 */

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
  // L'acceptation des conditions est la case du formulaire : la route la
  // vérifie avant d'appeler, et elle est **écrite ici**, dans la transaction
  // qui crée l'équipe — une équipe née sans sa preuve d'acceptation, ou une
  // preuve pour une équipe qui n'a pas pu naître, seraient deux mensonges.
  const db = await getDatabase();
  const normalizedTag = resolveTeamTag(tag);

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // « Une seule équipe active à la fois » n'est tenu par aucun index : le
    // contrôle se fait sous le verrou de la ligne du joueur, **celui que prend
    // `acceptIntoTeam`**, en toute première instruction (sous REPEATABLE READ,
    // une lecture ordinaire placée avant figerait l'instantané, et l'appartenance
    // relue ensuite serait périmée). Lu sur le pool, hors transaction, il
    // laissait passer deux créations simultanées — ou une création et une
    // acceptation — et le joueur finissait dans deux équipes actives.
    const [account] = await connection.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_users WHERE id = ? FOR UPDATE`,
      [ownerUserId],
    );
    if (account.length === 0) throw new Error("PROFILE_NOT_FOUND");

    const [existingMembership] = await connection.execute<(RowDataPacket & { id: number })[]>(
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

    if (!(await recordTermsAcceptance(ownerUserId, "TEAM_CREATION", connection))) {
      throw new Error("PROFILE_NOT_FOUND");
    }

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
  await assertCanActOnTeam(await userOwnsTeam(teamId, requesterId), requesterId, teamId, viewerManagesGhostTeams);

  const updates: string[] = [];
  const params: SqlParams = [];

  if (patch.name !== undefined) {
    // Mêmes bornes qu'à la création : le renommage n'en contrôlait aucune, si
    // bien qu'un nom vide s'enregistrait et qu'un nom trop long partait en
    // erreur MySQL brute jusqu'à la notification.
    const check = checkTeamName(patch.name);
    if (!check.ok) throw new Error(check.reason);
    await assertTeamNameAvailable(db, check.name, teamId);
    updates.push("name = ?");
    params.push(check.name);
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
  try {
    await mapTeamTagConflict(() =>
      db.execute(`UPDATE bg_teams SET ${updates.join(", ")} WHERE id = ?`, params));
  } catch (error) {
    // La course entre deux renommages vers le même nom : le `SELECT` préalable
    // les a laissés passer tous les deux, l'index tranche.
    if (isTeamNameConflict(error)) throw new Error(TEAM_NAME_ALREADY_USED);
    throw error;
  }
}

export async function updateTeamLogo(
  requesterId: number,
  teamId: number,
  logoPath: string | null,
  viewerManagesGhostTeams = false,
): Promise<void> {
  // Retirer un logo n'attend aucune acceptation : c'est justement le geste
  // qu'on veut voir faire à qui doute de ses droits sur l'image.
  await assertCanActOnTeam(
    await userCanManageTeam(teamId, requesterId),
    requesterId,
    teamId,
    viewerManagesGhostTeams,
    logoPath !== null,
  );
  const db = await getDatabase();
  await db.execute(`UPDATE bg_teams SET logo_url = ? WHERE id = ?`, [logoPath, teamId]);
}

/**
 * Retrait d'un logo d'équipe par la modération (permission `moderation`), sans
 * être membre de l'équipe — le geste qui suit un signalement de droit d'auteur.
 *
 * La ligne est relue **sous verrou** : un logo téléversé à l'instant par la
 * gestion de l'équipe serait sinon retiré à la place de celui qu'on a vu. Le
 * fichier, lui, est effacé par l'appelant **après** le commit (un `unlink` ne
 * se défait pas). Une entrée solo n'a pas de logo propre : c'est la copie de
 * l'avatar d'un joueur, qui n'est pas une équipe.
 *
 * @throws TEAM_NOT_FOUND
 * @throws TEAM_HAS_NO_LOGO
 */
export async function removeTeamLogoAsModerator(
  teamId: number,
): Promise<{ teamName: string; removedLogoUrl: string; sharedWithOtherTeams: boolean }> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<
      (RowDataPacket & { name: string; logo_url: string | null; solo_user_id: number | null })[]
    >(`SELECT name, logo_url, solo_user_id FROM bg_teams WHERE id = ? FOR UPDATE`, [teamId]);
    if (rows.length === 0 || rows[0].solo_user_id !== null) throw new Error("TEAM_NOT_FOUND");
    const logoUrl = rows[0].logo_url;
    if (!logoUrl) throw new Error("TEAM_HAS_NO_LOGO");
    await connection.execute(`UPDATE bg_teams SET logo_url = NULL WHERE id = ?`, [teamId]);
    // Un même fichier peut être désigné par plusieurs équipes (le jeu de test
    // en partage un) : l'effacer retirerait aussi le logo des autres. Même
    // règle que le masquage (`hideTeamLogo`).
    const [sharing] = await connection.execute<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total FROM bg_teams WHERE logo_url = ? AND id <> ?`,
      [logoUrl, teamId],
    );
    await connection.commit();
    return {
      teamName: rows[0].name,
      removedLogoUrl: logoUrl,
      sharedWithOtherTeams: Number(sharing[0]?.total ?? 0) > 0,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
