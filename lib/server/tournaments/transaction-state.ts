/**
 * État « après commit » d'une transaction : ce qu'elle a noté au fond de ses
 * écritures (lignes du journal, avis aux casters, aux arbitres, aux engagées
 * retirées, validations d'office) et qui ne part **qu'une fois commitée**.
 *
 * Une seule fabrique pour toutes ces files (revue sécurité LN-1 #483) : chacune
 * suit la connexion de sa transaction (`WeakMap` : une connexion oubliée
 * n'empêche pas son état d'être collecté) et n'a qu'un seul cycle de vie — vidée
 * par `flushBotLogs` après le commit, jetée par `discardBotLogs` si la
 * transaction échoue (`./bot-logs`), où **toute** file créée ici doit être
 * branchée (`tests/lib/server/transaction-state.test.ts` le vérifie). Une file
 * oubliée là resterait sur une connexion rendue au pool, et partirait avec la
 * transaction étrangère qui la reprendrait.
 */
import type { PoolConnection } from "mysql2/promise";

/** État d'une transaction, indexé par sa connexion (voir le module). */
export type TransactionState<S> = {
  /** L'état de la transaction, s'il existe (sans le créer). */
  peek(connection: PoolConnection): S | undefined;
  /** L'état de la transaction, créé vide au premier appel. */
  ensure(connection: PoolConnection): S;
  /** Rend l'état et l'efface : ce qui part (après le commit) ne repart jamais. */
  take(connection: PoolConnection): S | undefined;
  /** Efface l'état sans rien envoyer : la transaction n'a pas abouti. */
  discard(connection: PoolConnection): void;
};

/**
 * Crée l'état « après commit » d'un module.
 *
 * @param create État vide d'une transaction (au premier `ensure`).
 * @returns L'état, indexé par connexion.
 */
export function createTransactionState<S>(create: () => S): TransactionState<S> {
  const states = new WeakMap<PoolConnection, S>();
  return {
    peek: (connection) => states.get(connection),
    ensure(connection) {
      let state = states.get(connection);
      if (state === undefined) {
        state = create();
        states.set(connection, state);
      }
      return state;
    },
    take(connection) {
      const state = states.get(connection);
      states.delete(connection);
      return state;
    },
    discard(connection) {
      states.delete(connection);
    },
  };
}
