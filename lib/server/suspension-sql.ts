import type { PoolConnection, RowDataPacket } from "mysql2/promise";

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

/** Ce dont `lockedSuspendedUserIds` a besoin de la connexion (import de type seul). */
export type SuspensionReader = Pick<PoolConnection, "execute">;

/**
 * Les comptes de `ids` qu'une suspension tient, en lecture **courante et
 * verrouillée** (`LOCK IN SHARE MODE`, compris de MariaDB) : à jouer dans la
 * transaction du geste, **après** les lignes des comptes (l'ordre de
 * `suspendAccount`, qui tient le compte en exclusif jusqu'à sa validation) —
 * une suspension posée pendant le geste est attendue puis lue. Seule écriture
 * de cette lecture (planning, désignation d'un arbitre, dernier administrateur).
 */
export async function lockedSuspendedUserIds(executor: SuspensionReader, ids: readonly number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const [rows] = await executor.execute<(RowDataPacket & { user_id: number | string })[]>(
    `SELECT DISTINCT s.user_id FROM bg_account_suspensions s
      WHERE s.user_id IN (${ids.map(() => "?").join(", ")}) AND ${activeSuspensionSql("s")} LOCK IN SHARE MODE`,
    [...ids],
  );
  return new Set(rows.map((row) => Number(row.user_id)));
}
