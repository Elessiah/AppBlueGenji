/**
 * Une suspension qui court, écrite une fois pour toutes les lectures —
 * pendant SQL de `isSuspensionActive`. `alias` est celui de
 * `bg_account_suspensions` dans la requête appelante.
 *
 * Module sans dépendance : `push-subscriptions` (distribution au staff) la lit
 * sans tirer `account-suspensions`, qui dépend lui-même des notifications.
 */
export function activeSuspensionSql(alias: string): string {
  return `${alias}.lifted_at IS NULL AND ${alias}.starts_at <= NOW() AND (${alias}.ends_at IS NULL OR ${alias}.ends_at > NOW())`;
}

/**
 * `EXISTS (…)` vrai quand le compte `userColumn` (colonne de la requête
 * appelante, ex. `u.id`) a une suspension qui court — à préfixer de `NOT` pour
 * l'exclure. Une seule écriture de la sous-requête pour tous les lecteurs
 * (alias interne `sus`, à ne pas reprendre dans la requête appelante).
 */
export function userSuspendedSql(userColumn: string): string {
  return `EXISTS (SELECT 1 FROM bg_account_suspensions sus WHERE sus.user_id = ${userColumn} AND ${activeSuspensionSql("sus")})`;
}
