import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { syncSoloEntryIdentity, syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";

/**
 * Pose (ou retire) l'avatar d'un compte **vivant**, et dit si l'écriture a eu
 * lieu.
 *
 * La condition `is_deleted = 0` n'est pas une précaution de style : un
 * téléversement déjà parti se bloque sur le verrou de `deleteOwnAccount` et
 * reprend **après** son commit. Sans elle, il reposait une photo personnelle
 * toute neuve sur une ligne fraîchement anonymisée — publiquement servie par
 * `/api/uploads/avatars/…`, c'est-à-dire précisément ce que la suppression
 * venait d'effacer. Sur un compte effacé, la ligne a disparu et l'écriture ne
 * touche rien, mais le fichier, lui, est déjà sur le disque : d'où `null`
 * rendu, que l'appelant traduit en ménage.
 *
 * L'adresse **remplacée** est rendue, relue sous verrou dans la même
 * transaction que l'écriture : c'est le fichier à effacer. Relue avant, hors
 * verrou, elle pouvait avoir changé entre-temps — le renommage d'un avatar
 * masqué (`lib/server/avatar-rotation.ts`) déplace justement le fichier —, et
 * l'appelant effaçait l'ancien nom, en vain, en laissant le nouveau sur le
 * disque sans que plus rien ne le désigne, ni ne l'efface avec le compte.
 *
 * @returns `{ previousUrl }` si l'écriture a eu lieu, `null` sinon.
 */
export async function updateUserAvatar(
  userId: number,
  avatarPath: string | null,
): Promise<{ previousUrl: string | null } | null> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  let previousUrl: string | null;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<(RowDataPacket & { avatar_url: string | null })[]>(
      `SELECT avatar_url FROM bg_users WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
      [userId],
    );
    if (rows.length === 0) {
      await connection.rollback();
      return null;
    }
    previousUrl = rows[0].avatar_url;
    await connection.execute<ResultSetHeader>(
      `UPDATE bg_users SET avatar_url = ? WHERE id = ? AND is_deleted = 0`,
      [avatarPath, userId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
  // Le logo de l'entrée solo est l'avatar du joueur.
  await syncSoloEntryIdentity(userId);
  return { previousUrl };
}

/**
 * Retrait de l'avatar d'un joueur par la modération (permission `moderation`),
 * sans lien avec ce compte — même mécanique que
 * `removeTeamLogoAsModerator` (`lib/server/teams-service.ts`) : le geste qui
 * suit un signalement de droit d'auteur, ou une équipe (le logo d'une entrée
 * solo n'est que l'avatar de son joueur).
 *
 * La ligne est relue **sous verrou** : un avatar téléversé à l'instant serait
 * sinon retiré à la place de celui qu'on a vu. Le logo de l'entrée solo est
 * resynchronisé **dans la même transaction** (`syncSoloEntryIdentityOn`) :
 * sans elle, le fichier effacé par l'appelant resterait désigné par
 * `bg_teams.logo_url`. Le fichier, lui, est effacé par l'appelant **après le
 * commit** (un `unlink` ne se défait pas).
 *
 * @throws USER_NOT_FOUND
 * @throws USER_HAS_NO_AVATAR
 */
export async function removeUserAvatarAsModerator(
  userId: number,
): Promise<{ pseudo: string; removedAvatarUrl: string }> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<
      (RowDataPacket & { pseudo: string; avatar_url: string | null; is_deleted: 0 | 1 })[]
    >(`SELECT pseudo, avatar_url, is_deleted FROM bg_users WHERE id = ? FOR UPDATE`, [userId]);
    // Un compte anonymisé n'a déjà plus d'avatar (`anonymizeAccount` le vide) ;
    // le traiter comme introuvable évite de distinguer un cas qui ne se produit
    // pas d'une ligne disparue.
    if (rows.length === 0 || rows[0].is_deleted === 1) throw new Error("USER_NOT_FOUND");
    const avatarUrl = rows[0].avatar_url;
    if (!avatarUrl) throw new Error("USER_HAS_NO_AVATAR");
    await connection.execute(`UPDATE bg_users SET avatar_url = NULL WHERE id = ? AND is_deleted = 0`, [userId]);
    await syncSoloEntryIdentityOn(connection, userId);
    await connection.commit();
    return { pseudo: rows[0].pseudo, removedAvatarUrl: avatarUrl };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
