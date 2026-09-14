import type { Pool } from "mysql2/promise";
import { withNamedLock } from "@/lib/server/named-lock";

/**
 * Rejouer le schéma au démarrage, sans se condamner et sans se marcher dessus.
 *
 * `runMigrations` est rejoué à chaque démarrage de processus, et `next dev` en
 * lance plusieurs : deux `ALTER TABLE` concurrents sur la même table font
 * déclarer un interblocage par MySQL, qui en choisit une victime. Deux fautes
 * distinctes s'ensuivaient, et il faut les deux corrections.
 *
 * D'abord la **victime restait morte** : la promesse mémorisée par la porte
 * d'entrée était conservée telle quelle, rejetée comprise, si bien que chaque
 * requête suivante rejouait l'échec sans jamais retenter la manœuvre — seul un
 * redémarrage du serveur débloquait. D'où {@link createOnceGate}, qui ne
 * mémorise **que les succès**.
 *
 * Ensuite la concurrence elle-même : {@link withMigrationLock} sérialise les
 * migrations derrière un verrou **nommé** (`GET_LOCK`), qui vaut entre
 * processus — un verrou en mémoire ne protégerait que le sien, et c'est
 * précisément entre deux processus que l'interblocage se produit. Le mécanisme
 * lui-même vit dans `named-lock.ts` depuis qu'il a un second usage (l'émission
 * des codes de connexion Discord) ; il ne reste ici que ce qui regarde les
 * migrations.
 */

/** Nom du verrou consultatif MySQL qui sérialise les migrations. */
export const MIGRATION_LOCK_NAME = "bg_migrations";

/**
 * Attente maximale du verrou, en secondes.
 *
 * Assez large pour laisser un premier processus dérouler tout le schéma sur une
 * base vide, assez courte pour que l'échec finisse par se voir plutôt que de
 * suspendre indéfiniment la première requête du site.
 */
export const MIGRATION_LOCK_TIMEOUT_SECONDS = 60;

/**
 * Joue `run` sous le verrou des migrations, une instance à la fois.
 *
 * Voir `named-lock.ts` pour la mécanique (session MySQL, connexion tenue,
 * destruction si le verrou ne peut pas être rendu).
 */
export function withMigrationLock<T>(pool: Pool, run: () => Promise<T>): Promise<T> {
  // La connexion du verrou n'est **pas** celle qui travaille : les migrations
  // sont longues, elles continuent de passer par le pool.
  return withNamedLock(pool, MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS, () => run());
}

/** Porte d'entrée qui ne joue sa tâche qu'une fois — tant qu'elle réussit. */
export interface OnceGate {
  /**
   * Joue `task` au premier appel et rend la même promesse aux suivants. Un
   * échec est **oublié** : l'appel d'après rejoue la tâche.
   */
  run(task: () => Promise<void>): Promise<void>;
}

/** Construit une {@link OnceGate}. */
export function createOnceGate(): OnceGate {
  let pending: Promise<void> | null = null;

  return {
    run(task) {
      if (!pending) {
        const started = task();
        pending = started;
        // L'oubli se fait sur l'**identité** de la promesse : entre le rejet et
        // ce rappel, un autre appelant a pu en démarrer une nouvelle, qu'il ne
        // faut surtout pas effacer.
        started.catch(() => {
          if (pending === started) pending = null;
        });
      }
      return pending;
    },
  };
}
