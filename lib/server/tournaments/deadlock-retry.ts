import { randomInt } from "node:crypto";
import { isTransactionAborted } from "@/lib/server/mysql-errors";

const DEADLOCK_ATTEMPTS = 3;

/**
 * Rejoue une écriture annulée par un interblocage InnoDB : les verrous
 * d'intervalle (`bg_match_maps`, `bg_match_reminders`) peuvent opposer deux
 * écritures sur des matchs voisins — report d'équipe, geste d'arbitrage,
 * programmation d'un horaire. Toute autre erreur remonte telle quelle.
 */
export async function retryOnDeadlock<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      if (!isTransactionAborted(error) || attempt >= DEADLOCK_ATTEMPTS) throw error;
      // Attente courte et aléatoire : deux transactions annulées ensemble ne
      // repartent pas au même instant pour se heurter de nouveau.
      await new Promise((resolve) => setTimeout(resolve, randomInt(20, 81)));
    }
  }
}
