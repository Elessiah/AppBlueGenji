import crypto from "node:crypto";
import path from "node:path";
import { rename } from "node:fs/promises";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { toDiskUploadPath } from "@/lib/shared/uploads";

/**
 * Change l'adresse du fichier d'un avatar qu'on vient de **masquer**.
 *
 * `visibleAvatarUrl` retire l'URL de toutes les réponses dès que
 * `visible_avatar = 0`, mais le fichier, lui, reste sous `public/uploads/avatars`
 * — servi sans session par `/api/uploads/avatars/…` comme par le serveur
 * statique, à la même adresse. Quiconque l'avait vue avant le masquage (un
 * adversaire, un historique de navigation, un lien collé sur Discord) gardait
 * donc l'image. Le masquage n'était vrai qu'à la source, pas au fichier.
 *
 * Renommer le fichier sous un nouveau nom aléatoire rend l'ancienne adresse
 * morte (404 partout) : seul le titulaire, à qui sa fiche rend l'URL même
 * masquée, apprend la nouvelle. Pas de route d'avatars filtrée à la place :
 * elle ne fermerait pas le chemin du serveur statique, et chaque image du site
 * paierait une lecture de base pour un cas rare.
 *
 * Ce que le renommage ne rattrape pas, et que rien ne peut rattraper : la copie
 * déjà gardée dans le cache d'un navigateur qui l'a affichée.
 *
 * Ordre des gestes : le fichier est renommé **avant** l'écriture, et remis en
 * place si l'écriture n'aboutit pas (ligne anonymisée, avatar remplacé ou
 * réaffiché entre-temps) — l'inverse laisserait une base qui désigne un fichier
 * absent. L'`UPDATE` porte l'ancienne URL et le masquage dans son `WHERE`, si
 * bien qu'un téléversement concurrent n'est jamais écrasé.
 *
 * @returns La nouvelle URL, ou `null` si rien n'a été renommé (avatar visible,
 *   absent, étranger au site, fichier déjà introuvable, course perdue).
 */
export async function rotateHiddenAvatarFile(userId: number): Promise<string | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { avatar_url: string | null; visible_avatar: 0 | 1 })[]>(
    `SELECT avatar_url, visible_avatar FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row || row.visible_avatar !== 0 || !row.avatar_url) return null;

  const target = rotatedAvatarTarget(row.avatar_url, userId);
  if (!target) return null;

  try {
    await rename(target.from, target.to);
  } catch (error) {
    // Déjà absent (quarantaine, ménage) : il n'y a plus rien à servir.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let written = false;
  try {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE bg_users SET avatar_url = ?
       WHERE id = ? AND avatar_url = ? AND visible_avatar = 0 AND is_deleted = 0`,
      [target.url, userId, row.avatar_url],
    );
    written = result.affectedRows > 0;
  } finally {
    if (!written) await rename(target.to, target.from).catch(() => undefined);
  }
  return written ? target.url : null;
}

/** Nom d'un avatar tel que `storeImageBuffer` l'écrit. */
const AVATAR_FILENAME = /^[A-Za-z0-9_-]+\.webp$/;
const AVATAR_DISK_PREFIX = "/uploads/avatars/";

/**
 * Chemins d'origine et de destination d'un renommage, et l'URL à écrire — même
 * forme que l'ancienne (`/api/uploads/…` ou `/uploads/…`). `null` pour tout ce
 * qui n'est pas un avatar téléversé chez nous.
 */
export function rotatedAvatarTarget(
  avatarUrl: string,
  userId: number,
): { from: string; to: string; url: string } | null {
  const disk = toDiskUploadPath(avatarUrl);
  if (!disk || !disk.startsWith(AVATAR_DISK_PREFIX)) return null;
  const filename = disk.slice(AVATAR_DISK_PREFIX.length);
  if (!AVATAR_FILENAME.test(filename) || !Number.isSafeInteger(userId) || userId <= 0) return null;
  const nextName = `${userId}-${crypto.randomBytes(8).toString("hex")}.webp`;
  const dir = path.join(process.cwd(), "public", "uploads", "avatars");
  return {
    from: path.join(dir, filename),
    to: path.join(dir, nextName),
    url: avatarUrl.slice(0, avatarUrl.length - filename.length) + nextName,
  };
}
