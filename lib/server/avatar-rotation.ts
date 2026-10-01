import crypto from "node:crypto";
import path from "node:path";
import { copyFile, readdir, readFile, rename, rm, unlink } from "node:fs/promises";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isUploadReferenced } from "@/lib/server/stored-upload-cleanup";
import { toDiskUploadPath, toServedUploadUrl } from "@/lib/shared/uploads";

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
 * **L'optimiseur d'images garde sa propre copie.** `UserAvatar` passe par
 * `next/image` : ce que les lecteurs chargent est `/_next/image?url=<ancienne
 * adresse>&w=…`, que Next sert depuis `.next/cache/images` sans relire la
 * source tant que l'entrée est fraîche (un an, la durée annoncée par
 * `/api/uploads`) — et qu'il sert encore une fois périmée, en la gardant quand
 * la source répond 404. Le renommage purge donc ces entrées
 * (`purgeOptimizedCopies`).
 *
 * Ce que rien ne peut rattraper : la copie déjà gardée dans le cache d'un
 * navigateur qui l'a affichée.
 *
 * **Un fichier désigné ailleurs est copié, pas renommé.** Un logo de partenaire
 * ou d'équipe, une photo de bénévole acceptent une adresse collée, donc aussi
 * celle d'un avatar : renommer casserait cette image-là sans bruit. Le compte
 * reçoit alors une copie sous un nom neuf, et l'ancienne adresse reste servie —
 * elle l'est par un choix de publication qui n'est pas celui du joueur, et que
 * son réglage ne peut pas défaire. L'entrée solo du joueur ne compte pas : elle
 * a déjà été vidée par la resynchronisation, que l'appelant joue avant.
 *
 * Ordre des gestes : le fichier est renommé **avant** l'écriture — l'inverse
 * laisserait une base qui désigne un fichier absent. L'`UPDATE` porte
 * l'ancienne URL et le masquage dans son `WHERE`, si bien qu'un téléversement
 * concurrent n'est jamais écrasé. Si l'écriture n'aboutit pas, voir
 * `undoRotation`.
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
  if (row?.visible_avatar !== 0 || !row.avatar_url) return null;

  const target = rotatedAvatarTarget(row.avatar_url, userId);
  if (!target) return null;

  const shared = await isUploadReferenced(row.avatar_url, { exceptUserAvatar: userId });
  let original: Buffer | null = null;
  try {
    if (!shared) original = await readFile(target.from);
    await (shared ? copyFile(target.from, target.to) : rename(target.from, target.to));
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
    if (!written) await undoRotation(userId, row.avatar_url, target, shared);
  }
  // Un fichier partagé reste servi à l'ancienne adresse : ses variantes
  // optimisées n'en disent pas plus que lui.
  if (written && original) {
    // Une adresse de forme ancienne (`/uploads/…`) est servie par le serveur
    // statique, qui pose un `ETag` : Next range alors ses variantes sous cet
    // en-tête et non sous l'empreinte des octets, que la purge ne reconnaît
    // plus. Cas hérité et rare (toute écriture actuelle pose `/api/uploads/…`) :
    // on vide tout le cache de l'optimiseur, qui se reconstruit à la demande.
    if (row.avatar_url.startsWith("/uploads/")) await purgeAllOptimizedCopies();
    else await purgeOptimizedCopies(original);
  }
  return written ? target.url : null;
}

/**
 * Défait un renommage dont l'écriture n'a pas abouti. Selon ce que la ligne
 * désigne à la relecture : le **nouveau** fichier (réponse perdue après le
 * commit) → rien à défaire ; l'**ancienne** adresse (avatar réaffiché
 * entre-temps), ou relecture impossible → remis en place, on ne détruit pas ce
 * que la base désigne peut-être encore. Remplacé ou effacé, il est supprimé :
 * le téléversement concurrent a déjà tenté
 * d'effacer l'ancien fichier, en vain puisqu'il était renommé, et le remettre en
 * place republierait un avatar masqué que plus rien ne désigne ni n'effacera.
 * Une copie (fichier partagé) est toujours supprimée, l'original n'ayant pas
 * bougé.
 */
async function undoRotation(
  userId: number,
  oldUrl: string,
  target: { from: string; to: string; url: string },
  shared: boolean,
): Promise<void> {
  // `undefined` : la ligne n'a pas pu être relue.
  let current: string | null | undefined;
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<(RowDataPacket & { avatar_url: string | null })[]>(
      `SELECT avatar_url FROM bg_users WHERE id = ? LIMIT 1`,
      [userId],
    );
    current = rows[0]?.avatar_url ?? null;
  } catch {
    current = undefined;
  }
  // L'écriture a abouti malgré l'erreur (réponse perdue après le commit) : la
  // ligne désigne déjà le nouveau fichier, il reste en place.
  if (current === target.url) return;
  let undo: Promise<void>;
  if (shared) undo = unlink(target.to);
  // Encore désignée, ou impossible à dire : on ne détruit rien, l'avatar
  // retrouve son adresse — la base la désigne peut-être toujours.
  else if (current === oldUrl || current === undefined) undo = rename(target.to, target.from);
  else undo = unlink(target.to);
  await undo.catch(() => undefined);
}

/** Cache de l'optimiseur de `next/image` (`distDir` par défaut, celui du projet). */
export function optimizedImageCacheDirectory(): string {
  return path.join(process.cwd(), ".next", "cache", "images");
}

/**
 * Efface les variantes optimisées d'une image source. Next range chaque variante
 * dans `<cache>/<clé>/<maxAge>.<expireAt>.<etag>.<upstreamEtag>.<extension>`,
 * où `upstreamEtag` est le SHA-256 base64url des octets de la **source**
 * (`getImageEtag`) : on reconnaît donc toutes les variantes — largeurs,
 * formats, adresse `/uploads` ou `/api/uploads` — sans connaître leur clé. Au
 * mieux : un cache absent, ou un format de nom qui changerait avec Next, ne fait
 * qu'échouer à purger.
 *
 * @returns Le nombre d'entrées effacées.
 */
export async function purgeOptimizedCopies(source: Buffer): Promise<number> {
  const upstreamEtag = crypto.createHash("sha256").update(source).digest("base64url");
  const root = optimizedImageCacheDirectory();
  let purged = 0;
  try {
    for (const entry of await readdir(root)) {
      const dir = path.join(root, entry);
      const files = await readdir(dir).catch(() => [] as string[]);
      if (files.some((file) => file.split(".")[3] === upstreamEtag)) {
        await rm(dir, { recursive: true, force: true });
        purged += 1;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[avatar-rotation] cache de l'optimiseur non purgé", error);
    }
  }
  return purged;
}

/** Vide tout le cache de l'optimiseur d'images (au mieux). */
export async function purgeAllOptimizedCopies(): Promise<void> {
  try {
    await rm(optimizedImageCacheDirectory(), { recursive: true, force: true });
  } catch (error) {
    console.error("[avatar-rotation] cache de l'optimiseur non vidé", error);
  }
}

/** Nom d'un avatar tel que `storeImageBuffer` l'écrit. */
const AVATAR_FILENAME = /^[A-Za-z0-9_-]+\.webp$/;
const AVATAR_DISK_PREFIX = "/uploads/avatars/";

/**
 * Chemins d'origine et de destination d'un renommage, et l'URL à écrire —
 * toujours sous la forme servie (`/api/uploads/…`), celle de toute écriture
 * actuelle : une ancienne forme `/uploads/…` est ainsi convertie au premier
 * renommage, et ne coûte qu'une fois le vidage complet du cache de
 * l'optimiseur. `null` pour tout ce qui n'est pas un avatar téléversé chez nous.
 */
export function rotatedAvatarTarget(
  avatarUrl: string,
  userId: number,
): { from: string; to: string; url: string } | null {
  const disk = toDiskUploadPath(avatarUrl);
  if (!disk?.startsWith(AVATAR_DISK_PREFIX)) return null;
  const filename = disk.slice(AVATAR_DISK_PREFIX.length);
  if (!AVATAR_FILENAME.test(filename) || !Number.isSafeInteger(userId) || userId <= 0) return null;
  const nextName = `${userId}-${crypto.randomBytes(8).toString("hex")}.webp`;
  const dir = path.join(process.cwd(), "public", "uploads", "avatars");
  return {
    from: path.join(dir, filename),
    to: path.join(dir, nextName),
    url: toServedUploadUrl(`${AVATAR_DISK_PREFIX}${nextName}`),
  };
}
