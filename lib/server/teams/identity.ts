import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
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
import { invalidateTeamIdentityViews } from "@/lib/server/ranking-cache";
import { hasTeamManagementRole } from "@/lib/shared/team-roles";
import { assertCanActOnTeam, lockMemberRoles, teamEverRegistered, userCanManageTeam, userOwnsTeam } from "./access";

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
 *
 * Tout se joue sous le verrou de la ligne de l'équipe, en toute première
 * instruction — celui de la dissolution et des gestes du roster : le nom
 * actuel se relit dessous (lu avant, sur le pool, deux renommages simultanés
 * lisaient le même ancien nom), et le droit est **rejugé** (un propriétaire qui
 * vient de transférer l'équipe, ou le staff sur une fantôme reprise
 * entre-temps, ne la renomme plus ; une équipe dissoute non plus).
 */
export async function updateTeamMeta(
  requesterId: number,
  teamId: number,
  patch: { name?: string; description?: string | null; tag?: string | null },
  viewerManagesGhostTeams = false,
): Promise<void> {
  const db = await getDatabase();
  const viaOwnership = await userOwnsTeam(teamId, requesterId);
  await assertCanActOnTeam(viaOwnership, requesterId, teamId, viewerManagesGhostTeams);

  // Mêmes bornes qu'à la création : le renommage n'en contrôlait aucune, si
  // bien qu'un nom vide s'enregistrait et qu'un nom trop long partait en
  // erreur MySQL brute jusqu'à la notification. Jugées avant la transaction :
  // un nom refusé n'ouvre rien.
  let wantedName: string | undefined;
  if (patch.name !== undefined) {
    const check = checkTeamName(patch.name);
    if (!check.ok) throw new Error(check.reason);
    wantedName = check.name;
  }
  if (patch.name === undefined && patch.description === undefined && patch.tag === undefined) return;

  let renamed = false;
  let everRegistered = false;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const currentName = await lockEditableTeam(connection, teamId, requesterId, viaOwnership);
    // Le formulaire renvoie toujours le nom : seul un nom **changé** (casse
    // comprise, comparaison exacte) s'écrit et vide les vues qui le montrent —
    // sans quoi chaque enregistrement d'une description ferait recalculer
    // podium et cartes d'aperçu aux visiteurs.
    renamed = wantedName !== undefined && currentName !== wantedName;
    await writeTeamMeta(connection, teamId, {
      name: renamed ? wantedName : undefined,
      description: patch.description,
      tag: patch.tag,
    });
    if (renamed) everRegistered = await teamEverRegistered(connection, teamId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  // Le nom est servi par l'accueil et `/classement` depuis le cache de la
  // vitrine (leaderboard, bandeau, mini-arbre) et par la liste du classement
  // (podium, cartes d'aperçu) : sans cela, l'ancien nom y restait jusqu'à 60 s.
  // Une équipe jamais inscrite n'y figure pas (aucun match, aucun rang) : la
  // renommer en boucle ne vide plus rien.
  if (renamed && everRegistered) invalidateTeamIdentityViews();
}

/**
 * Verrouille la ligne de l'équipe (première instruction de la transaction),
 * rejuge le droit dessous et rend le nom actuel. Refus `FORBIDDEN` : équipe
 * dissoute, propriétaire qui ne l'est plus, ou fantôme reprise pour le staff.
 */
async function lockEditableTeam(
  connection: PoolConnection,
  teamId: number,
  requesterId: number,
  viaOwnership: boolean,
): Promise<string> {
  const [locked] = await connection.execute<
    (RowDataPacket & { name: string; deleted_at: Date | null; is_ghost: 0 | 1 })[]
  >(`SELECT name, deleted_at, is_ghost FROM bg_teams WHERE id = ? FOR UPDATE`, [teamId]);
  if (locked.length === 0 || locked[0].deleted_at) throw new Error("FORBIDDEN");
  const allowed = viaOwnership
    ? Boolean((await lockMemberRoles(connection, teamId, requesterId))?.includes("OWNER"))
    : locked[0].is_ghost === 1;
  if (!allowed) throw new Error("FORBIDDEN");
  return locked[0].name;
}

/**
 * Écrit les champs fournis (`name` : déjà vérifié et **changé**), sous le
 * verrou de l'équipe. Nom et sigle se contrôlent avant l'écriture ; l'index
 * tranche un renommage concurrent vers le même nom.
 */
async function writeTeamMeta(
  connection: PoolConnection,
  teamId: number,
  fields: { name?: string; description?: string | null; tag?: string | null },
): Promise<void> {
  const updates: string[] = [];
  const params: SqlParams = [];
  if (fields.name !== undefined) {
    await assertTeamNameAvailable(connection, fields.name, teamId);
    updates.push("name = ?");
    params.push(fields.name);
  }
  if (fields.description !== undefined) {
    updates.push("description = ?");
    params.push(fields.description?.trim() ? fields.description.trim() : null);
  }
  if (fields.tag !== undefined) {
    const normalizedTag = resolveTeamTag(fields.tag);
    // L'équipe garde le sien : sans cette exclusion, réenregistrer la fiche
    // sans toucher au sigle le déclarerait pris par elle-même.
    await assertTeamTagAvailable(connection, normalizedTag, teamId);
    updates.push("tag = ?");
    params.push(normalizedTag);
  }
  if (updates.length === 0) return;
  params.push(teamId);
  try {
    await mapTeamTagConflict(() =>
      connection.execute(`UPDATE bg_teams SET ${updates.join(", ")} WHERE id = ?`, params));
  } catch (error) {
    // Un renommage concurrent vers le même nom par une **autre** équipe :
    // le `SELECT` préalable l'a laissé passer, l'index tranche.
    if (isTeamNameConflict(error)) throw new Error(TEAM_NAME_ALREADY_USED);
    throw error;
  }
}

/**
 * Pose (ou retire, `null`) le logo d'une équipe et rend l'adresse de celui
 * qu'il remplace, que l'appelant efface **après** le commit.
 *
 * L'ancienne adresse se relit **sous verrou**, dans la transaction de
 * l'écriture : lue avant, deux envois (ou un envoi et un retrait) simultanés
 * lisaient le même ancien logo, et le fichier posé par le premier n'était plus
 * désigné par rien — servi à son adresse publique, hors de portée de la
 * conservation et de la modération. Même règle que `removeTeamLogoAsModerator`.
 */
export async function updateTeamLogo(
  requesterId: number,
  teamId: number,
  logoPath: string | null,
  viewerManagesGhostTeams = false,
): Promise<{ previousLogoUrl: string | null }> {
  // Retirer un logo n'attend aucune acceptation : c'est justement le geste
  // qu'on veut voir faire à qui doute de ses droits sur l'image.
  const viaRole = await userCanManageTeam(teamId, requesterId);
  await assertCanActOnTeam(viaRole, requesterId, teamId, viewerManagesGhostTeams, logoPath !== null);
  const db = await getDatabase();
  const connection = await db.getConnection();
  let previousLogoUrl: string | null = null;
  /** Inscrite au moins une fois : seule une telle équipe figure aux vues mises en cache. */
  let everRegistered = false;
  try {
    await connection.beginTransaction();
    // Le droit est **rejugé** sous le verrou, comme à la dissolution
    // (`softDeleteTeam`) : lu seulement avant, un envoi croisé avec une
    // dissolution reposait un logo sur l'équipe anonymisée, et un gérant
    // rétrogradé (ou le staff sur une fantôme reprise) l'écrivait encore.
    const [rows] = await connection.execute<
      (RowDataPacket & { logo_url: string | null; deleted_at: Date | null; is_ghost: 0 | 1 })[]
    >(`SELECT logo_url, deleted_at, is_ghost FROM bg_teams WHERE id = ? FOR UPDATE`, [teamId]);
    if (rows.length === 0 || rows[0].deleted_at) throw new Error("FORBIDDEN");
    if (viaRole) {
      if (!hasTeamManagementRole(await lockMemberRoles(connection, teamId, requesterId))) {
        throw new Error("FORBIDDEN");
      }
    } else if (rows[0].is_ghost !== 1) {
      throw new Error("FORBIDDEN");
    }
    previousLogoUrl = rows[0].logo_url ?? null;
    await connection.execute(`UPDATE bg_teams SET logo_url = ? WHERE id = ?`, [logoPath, teamId]);
    if (previousLogoUrl !== logoPath) everRegistered = await teamEverRegistered(connection, teamId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  // Logo servi par le leaderboard de l'accueil et de `/classement` (cache de la
  // vitrine), le podium et les cartes d'aperçu (liste du classement) — vidés
  // seulement s'il a changé : retirer un logo absent ne coûte rien aux visiteurs,
  // et seulement pour une équipe déjà inscrite à un tournoi — aucune de ces
  // vues ne montre une équipe qui n'a jamais joué.
  if (previousLogoUrl !== logoPath && everRegistered) invalidateTeamIdentityViews();
  return { previousLogoUrl };
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
    // Un logo retiré par la modération ne reste servi par aucun cache.
    invalidateTeamIdentityViews();
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

