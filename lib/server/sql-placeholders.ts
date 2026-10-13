/**
 * Placeholders `?, ?, ?` d'un `IN (...)` : `execute` ne développe pas les
 * tableaux, les identifiants restent des paramètres liés, jamais interpolés
 * dans le SQL.
 */
export function sqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
