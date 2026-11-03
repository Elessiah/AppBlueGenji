import type { PoolConnection } from "mysql2/promise";

/**
 * Délai d'attente d'un verrou, en secondes, pour un geste du staff qui tient le
 * verrou du tournoi puis verrouille des manches (annulation d'un abandon,
 * retrait d'une pénalité). Un détenteur qui ne demande jamais le tournoi
 * (programmation, rappels, « Prêt ») ne forme pas d'interblocage : sans borne,
 * le geste l'attendrait jusqu'à `innodb_lock_wait_timeout` (50 s par défaut)
 * en tenant le verrou du tournoi, et tout report du plateau avec lui. Passé ce
 * délai, le staff lit « réessaie » (409, `ER_LOCK_WAIT_TIMEOUT`).
 */
export const SHORT_LOCK_WAIT_SECONDS = 5;

/**
 * Exécute `read` sous un délai de verrou court, puis remet celui du serveur.
 * Pour la **seule** lecture verrouillée des manches : le verrou du tournoi,
 * pris avant, s'attend sans borne (son détenteur le rend sans rien attendre du
 * geste), et le rejeu qui suit garde le délai du serveur — des écritures qui
 * tolèrent un dépassement de délai (journal du bot, alertes) perdraient sinon
 * leur ligne en silence. Une remise ratée est rattrapée au retour au pool
 * ({@link releaseWithServerLockWait}).
 */
export async function withShortLockWait<T>(connection: PoolConnection, read: () => Promise<T>): Promise<T> {
  await connection.query(`SET SESSION innodb_lock_wait_timeout = ${SHORT_LOCK_WAIT_SECONDS}`);
  try {
    return await read();
  } finally {
    try {
      await connection.query(`SET SESSION innodb_lock_wait_timeout = DEFAULT`);
    } catch {
      // Rattrapée au retour au pool (`releaseWithServerLockWait`).
    }
  }
}

/**
 * Rend la connexion au pool avec le délai de verrou du serveur, filet de
 * {@link withShortLockWait} : rendue avec le délai court, elle l'imposerait à
 * la requête suivante. Si la remise échoue, la connexion est détruite plutôt
 * que rendue.
 */
export async function releaseWithServerLockWait(connection: PoolConnection): Promise<void> {
  try {
    await connection.query(`SET SESSION innodb_lock_wait_timeout = DEFAULT`);
  } catch {
    connection.destroy();
    return;
  }
  connection.release();
}
