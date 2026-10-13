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
