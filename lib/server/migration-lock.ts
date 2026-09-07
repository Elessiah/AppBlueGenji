import type { Pool, RowDataPacket } from "mysql2/promise";

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
 * précisément entre deux processus que l'interblocage se produit.
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
 * Joue `run` sous le verrou nommé, une instance à la fois.
 *
 * Le verrou est lié à la **session** MySQL, pas à la requête : il faut donc
 * tenir la même connexion du `GET_LOCK` au `RELEASE_LOCK`, une connexion
 * empruntée au pool à chaque instruction relâcherait le verrou aussitôt pris.
 * Les migrations, elles, continuent de passer par le pool — le verrou n'a pas à
 * être la connexion qui travaille.
 *
 * Si le verrou ne peut pas être relâché (connexion morte), la connexion est
 * **détruite** plutôt que rendue au pool : c'est la fin de la session qui libère
 * alors le verrou, sans quoi une connexion recyclée le garderait et le prochain
 * démarrage attendrait soixante secondes pour rien.
 */
export async function withMigrationLock<T>(pool: Pool, run: () => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  let held = false;
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT GET_LOCK(?, ?) AS acquired",
      [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS],
    );
    // `GET_LOCK` rend 1 (obtenu), 0 (délai dépassé) ou NULL (erreur).
    held = Number(rows?.[0]?.acquired ?? 0) === 1;
    if (!held) {
      throw new Error(
        `Migrations: verrou « ${MIGRATION_LOCK_NAME} » indisponible après ${MIGRATION_LOCK_TIMEOUT_SECONDS} s`,
      );
    }
    return await run();
  } finally {
    let released = false;
    if (held) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK_NAME]);
        released = true;
      } catch {
        // Connexion perdue : la destruction ci-dessous rendra le verrou.
      }
    } else {
      released = true;
    }
    if (released) {
      connection.release();
    } else {
      connection.destroy();
    }
  }
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
