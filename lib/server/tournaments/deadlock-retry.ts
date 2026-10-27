import { randomInt } from "node:crypto";
import { isTransactionAborted } from "@/lib/server/mysql-errors";

/**
 * MariaDB (11.6.2 et plus, `innodb_snapshot_isolation`) refuse d'écrire une
 * ligne changée depuis l'image lue par la transaction : `ER_CHECKREAD` (1020).
 * Rejouer la transaction entière relit l'état récent — même remède qu'un
 * interblocage.
 */
export function isSnapshotConflict(error: unknown): boolean {
  const code = (error as { code?: unknown; errno?: unknown } | null) ?? null;
  return code?.code === "ER_CHECKREAD" || code?.errno === 1020;
}

const DEADLOCK_ATTEMPTS = 3;

/**
 * Rejoue une écriture annulée par un interblocage InnoDB (ou refusée par
 * l'isolation par instantané de MariaDB) : les verrous
 * d'intervalle (`bg_match_maps`, `bg_match_reminders`) peuvent opposer deux
 * écritures sur des matchs voisins — report d'équipe, geste d'arbitrage,
 * programmation d'un horaire. Toute autre erreur remonte telle quelle.
 */
export async function retryOnDeadlock<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      const replayable = isTransactionAborted(error) || isSnapshotConflict(error);
      if (!replayable || attempt >= DEADLOCK_ATTEMPTS) throw error;
      // Attente courte et aléatoire : deux transactions annulées ensemble ne
      // repartent pas au même instant pour se heurter de nouveau.
      await new Promise((resolve) => setTimeout(resolve, randomInt(20, 81)));
    }
  }
}
