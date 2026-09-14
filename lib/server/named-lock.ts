import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

/**
 * Sérialiser un traitement derrière un **verrou nommé** de MySQL (`GET_LOCK`).
 *
 * Extrait de `migration-lock.ts`, qui en a été le premier usage et reste le
 * second appelant. Le mécanisme vaut bien au-delà des migrations : partout où il
 * faut qu'**un seul appelant à la fois** traverse une section, entre processus
 * compris — un verrou en mémoire ne protège que le sien, et Next lance plusieurs
 * processus.
 *
 * **Pourquoi un verrou nommé plutôt qu'un verrou de lignes.** La tentation
 * naturelle, pour « compter puis insérer sans se marcher dessus », est une
 * lecture verrouillante (`SELECT … FOR UPDATE`) suivie de l'insertion, dans une
 * transaction. Sur une plage **vide** — le cas courant, un compte qui n'a encore
 * aucune ligne — ce n'est pas seulement inefficace, c'est un **interblocage** :
 * chaque transaction pose un verrou d'intervalle sur la même plage, puis demande
 * pour insérer une intention qui entre en conflit avec l'intervalle des autres.
 * Personne ne peut avancer, et MySQL tue tout le monde sauf une victime. Mesuré,
 * pas supposé : douze demandes lancées de front rendaient onze
 * `ER_LOCK_DEADLOCK` et un seul code, là où cinq étaient attendus. Le verrou
 * nommé ne porte sur aucune ligne : il n'a ni intervalle ni ordre de prise,
 * donc pas d'interblocage possible.
 */

/** Échec d'**acquisition** du verrou — à distinguer d'un échec de la tâche. */
export class NamedLockUnavailableError extends Error {
  constructor(
    readonly lockName: string,
    readonly timeoutSeconds: number,
  ) {
    super(`Verrou « ${lockName} » indisponible après ${timeoutSeconds} s`);
    this.name = "NamedLockUnavailableError";
  }
}

/**
 * Joue `run` sous le verrou nommé `name`, un appelant à la fois.
 *
 * Le verrou est lié à la **session** MySQL, pas à la requête : il faut donc
 * tenir la même connexion du `GET_LOCK` au `RELEASE_LOCK` — une connexion
 * empruntée au pool à chaque instruction relâcherait le verrou aussitôt pris.
 * Cette connexion est passée à `run`, qui s'en sert ou non : une tâche brève a
 * tout intérêt à travailler dessus plutôt qu'à en emprunter une seconde, une
 * tâche longue (les migrations) préfère laisser la connexion du verrou libre.
 *
 * Si le verrou ne peut pas être relâché (connexion morte), la connexion est
 * **détruite** plutôt que rendue au pool : c'est la fin de la session qui libère
 * alors le verrou, sans quoi une connexion recyclée le garderait et l'appelant
 * suivant attendrait le délai complet pour rien.
 *
 * @throws NamedLockUnavailableError si le verrou n'est pas obtenu dans le délai.
 */
export async function withNamedLock<T>(
  pool: Pool,
  name: string,
  timeoutSeconds: number,
  run: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();
  let held = false;
  try {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS acquired", [
      name,
      timeoutSeconds,
    ]);
    // `GET_LOCK` rend 1 (obtenu), 0 (délai dépassé) ou NULL (erreur).
    held = Number(rows?.[0]?.acquired ?? 0) === 1;
    if (!held) {
      throw new NamedLockUnavailableError(name, timeoutSeconds);
    }
    return await run(connection);
  } finally {
    let released = false;
    if (held) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [name]);
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
