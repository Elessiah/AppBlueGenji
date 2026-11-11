import { randomInt } from "node:crypto";
import { isAutoIncrementContention, isSnapshotConflict, isTransactionAborted } from "@/lib/server/mysql-errors";

const DEADLOCK_ATTEMPTS = 3;

/**
 * Délai d'attente d'un verrou du serveur (`innodb_lock_wait_timeout`, 50 s par
 * défaut sous MySQL comme MariaDB ; la production garde le défaut), moins une
 * seconde de marge. Une attente du verrou AUTO-INC qui court jusqu'à ce délai
 * est rendue sous le **même** code que l'interblocage (`ER_AUTOINC_READ_FAILED`) ;
 * une tentative qui échoue sur ce code **avant** que ce délai ait pu s'écouler
 * ne peut donc être qu'un interblocage — rejoué.
 *
 * Le seuil n'est plus de 5 s : mesuré depuis le début de la tentative, il
 * comptait aussi l'attente d'une connexion du pool et des verrous pris avant
 * l'instruction fautive, si bien qu'un vrai interblocage AUTO-INC arrivé après
 * une attente lente n'était pas rejoué (409). Seules les **lectures**
 * verrouillées passent sous le délai court (`lock-wait.ts`) ; une insertion,
 * seule à prendre le verrou AUTO-INC, attend toujours sous celui du serveur.
 */
export const AUTOINC_WAITED_OUT_MS = 49_000;

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
      if (!isReplayableContention(error, Date.now() - startedAt) || attempt >= DEADLOCK_ATTEMPTS) {
        reportUnresolvedContention(error);
        throw error;
      }
      await replayPause();
    }
  }
}

/**
 * `true` si une tentative qui a échoué sur `error` après `elapsedMs` se
 * rejoue : interblocage, refus de l'instantané de MariaDB, ou
 * `ER_AUTOINC_READ_FAILED` rendu avant que le délai de verrou du serveur ait
 * pu s'écouler ({@link AUTOINC_WAITED_OUT_MS}). La règle unique de
 * {@link retryOnDeadlock} et des boucles de rejeu écrites à la main
 * (`markStaffPushed`).
 */
export function isReplayableContention(error: unknown, elapsedMs: number): boolean {
  if (isAutoIncrementContention(error)) return elapsedMs < AUTOINC_WAITED_OUT_MS;
  return isTransactionAborted(error) || isSnapshotConflict(error);
}

/**
 * Ce code est aussi celui d'un compteur illisible : s'il résiste au rejeu,
 * pm2 doit le dire en erreur — la route, elle, ne rendra qu'un « réessaie »
 * (`CONCURRENT_UPDATE_RETRY`).
 */
export function reportUnresolvedContention(error: unknown): void {
  if (isAutoIncrementContention(error)) console.error("[db] ER_AUTOINC_READ_FAILED non résolu par le rejeu", error);
}

/**
 * Attente courte et aléatoire avant un rejeu : deux transactions annulées
 * ensemble ne repartent pas au même instant pour se heurter de nouveau.
 */
export function replayPause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, randomInt(20, 81)));
}
