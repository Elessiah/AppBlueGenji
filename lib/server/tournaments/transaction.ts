import { failureReason } from "@/lib/server/failure-reason";
/**
 * Transaction d'un geste de match ou de tournoi (lancement, arbitrage, cartes
 * par tour) : journal du staff, alertes d'arbitrage et avis de cast et
 * d'arbitrage partent **après** le commit (`flushBotLogs`), et sont jetés sur
 * annulation.
 */
import type { PoolConnection } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { discardBotLogs, flushBotLogs } from "./bot-logs";

/**
 * Transaction sur une connexion déjà prise. Un `rollback()` en échec (connexion
 * coupée au milieu, par exemple) **détruit** la connexion au lieu de la rendre
 * au pool : rendue, elle resterait peut-être en transaction, et la prochaine
 * lecture « autonome » d'un autre geste y lirait l'ancienne vue sous ses
 * verrous. L'erreur d'origine remonte dans les deux cas.
 */
export async function transact<T>(connection: PoolConnection, run: (connection: PoolConnection) => Promise<T>): Promise<T> {
  await connection.beginTransaction();
  let result: T;
  try {
    result = await run(connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {
      // Détruite, la connexion quitte le pool : `release()` n'y fait plus rien.
      connection.destroy();
    });
    discardBotLogs(connection);
    throw error;
  }
  // Hors du `try` : le geste est enregistré. Une exception du vidage ne doit ni
  // lancer un rollback sans effet, ni répondre 500 pour un geste validé.
  try {
    flushBotLogs(connection);
  } catch (error) {
    console.error("[transaction] journal non vidé après le commit :", failureReason(error));
    // Ce qui reste en attente ne doit pas partir avec la transaction suivante
    // de cette connexion, rendue au pool.
    try {
      discardBotLogs(connection);
    } catch {
      // Rien de plus à tenter : le geste, lui, est enregistré.
    }
  }
  return result;
}

/** {@link transact} sur une connexion prise au pool pour l'occasion. */
export async function inTransaction<T>(run: (connection: PoolConnection) => Promise<T>): Promise<T> {
  return withConnection((connection) => transact(connection, run));
}
