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

/** Borne l'attente des verrous de la session, **avant** `beginTransaction`. */
export async function boundLockWait(connection: PoolConnection): Promise<void> {
  await connection.query(`SET SESSION innodb_lock_wait_timeout = ${SHORT_LOCK_WAIT_SECONDS}`);
}

/**
 * Rend la connexion au pool avec le délai de verrou du serveur : rendue avec
 * le délai court, elle l'imposerait à la requête suivante. Si la remise
 * échoue, la connexion est détruite plutôt que rendue.
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
