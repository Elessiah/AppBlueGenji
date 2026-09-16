// Les fichiers importés sont stockés sur disque sous `public/uploads/...`, mais
// servis via le route handler `/api/uploads/...` (le serveur statique de
// Turbopack ne sert pas les fichiers écrits après son démarrage). Ces deux
// helpers convertissent entre la forme « servie » (stockée en base, rendue dans
// les <img>) et la forme « disque » (utilisée pour supprimer le fichier).

const SERVED_PREFIX = "/api/uploads/";
const DISK_PREFIX = "/uploads/";

/** Chemin disque (`/uploads/...`) → URL servie (`/api/uploads/...`). */
export function toServedUploadUrl(diskRelPath: string): string {
  if (diskRelPath.startsWith(DISK_PREFIX)) {
    return SERVED_PREFIX + diskRelPath.slice(DISK_PREFIX.length);
  }
  return diskRelPath;
}

/**
 * URL servie (`/api/uploads/...`) ou ancienne URL disque (`/uploads/...`) →
 * chemin disque relatif (`/uploads/...`) pour la suppression de fichier.
 * Renvoie `null` pour les URLs externes (http…) qui ne nous appartiennent pas.
 */
export function toDiskUploadPath(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith(SERVED_PREFIX)) return DISK_PREFIX + url.slice(SERVED_PREFIX.length);
  if (url.startsWith(DISK_PREFIX)) return url;
  return null;
}

/**
 * L'URL, si c'est une image **à nous** ; `null` sinon.
 *
 * La garantie que le projet a posée pour les avatars et pour les logos de
 * partenaires — « le `src` d'une image du site est toujours une adresse du
 * site » — vaut pour toute colonne qui stocke une URL d'image. Trois d'entre
 * elles se remplissent à partir d'une saisie : `bg_teams.logo_url`,
 * `bg_users.avatar_url` et `bg_benevoles.photo_url`.
 *
 * Le prédicat est posé **à la sortie**, là où la ligne devient une réponse, et
 * non à l'écriture : une colonne se remplit par des chemins qu'on oublie
 * d'énumérer (un import, un seed, une migration, une copie d'une autre
 * colonne), alors qu'elle ne se lit que par les fonctions qui la sérialisent.
 * Et surtout, une garde à l'écriture ne dit rien des lignes **déjà** écrites.
 *
 * Ce n'est volontairement qu'un filtre de **forme** : il ne dit pas que le
 * fichier existe, seulement que l'adresse désigne notre origine. C'est
 * exactement ce dont `next/image` a besoin — il **lève** au rendu sur un hôte
 * absent de `remotePatterns`, et le projet n'en déclare aucun.
 */
export function localUploadUrl(url: string | null | undefined): string | null {
  return toDiskUploadPath(url) === null ? null : (url as string);
}
