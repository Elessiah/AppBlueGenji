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
