/**
 * Placeholders `?, ?, ?` d'un `IN (...)` : `execute` ne développe pas les
 * tableaux, les identifiants restent des paramètres liés, jamais interpolés
 * dans le SQL.
 */
export function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/** Taille par défaut d'un paquet d'identifiants glissés dans un `IN (…)`. */
export const SQL_ID_CHUNK = 500;

/**
 * Découpe une liste d'identifiants en paquets, pour borner chaque `IN (…)` :
 * la requête reste lisible par le planificateur et la taille du paquet sous
 * contrôle.
 */
export function chunkIds<T>(ids: readonly T[], size: number = SQL_ID_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let from = 0; from < ids.length; from += size) chunks.push(ids.slice(from, from + size));
  return chunks;
}
