import { randomInt } from "node:crypto";
import { isAutoIncrementContention, isSnapshotConflict, isTransactionAborted } from "@/lib/server/mysql-errors";

const DEADLOCK_ATTEMPTS = 3;

/**
 * Au-delà, un `ER_AUTOINC_READ_FAILED` n'est plus l'interblocage (détecté
 * sur-le-champ) mais une attente du verrou AUTO-INC qui a couru jusqu'à son
 * délai (`innodb_lock_wait_timeout`, 50 s) : comme `ER_LOCK_WAIT_TIMEOUT`, il
 * ne se rejoue pas — trois attentes de suite tiendraient une connexion et les
 * verrous de la transaction pendant des minutes.
 */
const AUTOINC_REPLAY_MAX_MS = 5_000;

/**
 * Rejoue une écriture annulée par un interblocage InnoDB — y compris celui que
 * MariaDB rend en `ER_AUTOINC_READ_FAILED` (verrou AUTO-INC de la table,
 * `isAutoIncrementContention`) — ou refusée par l'isolation par instantané de
 * MariaDB : les verrous
 * d'intervalle (`bg_match_maps`, `bg_match_reminders`) peuvent opposer deux
 * écritures sur des matchs voisins — report d'équipe, geste d'arbitrage,
 * programmation d'un horaire. Toute autre erreur remonte telle quelle.
 */
export async function retryOnDeadlock<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const startedAt = Date.now();
    try {
      return await write();
    } catch (error) {
      const replayable = isTransactionAborted(error) || isSnapshotConflict(error);
      if (!replayable || attempt >= DEADLOCK_ATTEMPTS) throw error;
      if (isAutoIncrementContention(error) && Date.now() - startedAt > AUTOINC_REPLAY_MAX_MS) throw error;
      // Attente courte et aléatoire : deux transactions annulées ensemble ne
      // repartent pas au même instant pour se heurter de nouveau.
      await new Promise((resolve) => setTimeout(resolve, randomInt(20, 81)));
    }
  }
}
