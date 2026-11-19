import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";

/**
 * SQL commun de la levée d'une incarnation (`docs/features/ADMIN_ROLE_IMPERSONATION.md`) :
 * retour d'une session (`player-view.ts`), rétrogradation (`clearAccountImpersonation`)
 * et balayage du démarrage (`catch-ups.ts`). Module sans dépendance à la base :
 * le balayage l'appelle pendant les migrations, sans passer par `getDatabase`.
 */

/**
 * Lance `run` avec la colonne `impersonated_roles_json` ; sans elle (`ALTER`
 * non joué), relance sans la nommer. Toute autre erreur remonte.
 */
export async function withRolesColumn<T>(run: (roles: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(true);
  } catch (error) {
    if (!isUnknownColumnError(error)) throw error;
    return run(false);
  }
}

/**
 * Lève l'incarnation **en cours** (échéance et rôles incarnés ; sans la colonne
 * des rôles, l'échéance seule) des sessions désignées par `where` — une
 * condition sur `bg_user_sessions` seule, jamais sur une autre table (aucun
 * verrou pris hors des sessions). Une échéance déjà passée reste, sans effet.
 *
 * @returns le nombre de sessions levées.
 */
export async function liftImpersonations(
  db: Pick<PoolConnection, "execute">,
  where: string,
  params: (string | number)[],
): Promise<number> {
  const [result] = await withRolesColumn((roles) =>
    db.execute<ResultSetHeader>(
      `UPDATE bg_user_sessions SET player_view_until = NULL${roles ? ", impersonated_roles_json = NULL" : ""}
       WHERE (${where}) AND player_view_until > NOW()`,
      params,
    ),
  );
  return Number(result.affectedRows ?? 0);
}
