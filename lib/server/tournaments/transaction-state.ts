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
 * branchée pour partir (`tests/lib/server/transaction-state.test.ts` le
 * vérifie). Et quoi qu'il en soit, `flushBotLogs` comme `discardBotLogs`
 * finissent par {@link clearTransactionStates}, qui efface **toutes** les files
 * créées ici : une file oubliée au vidage ne part pas, et ne reste pas sur la
 * connexion pour partir avec la transaction **suivante sur le même objet**
 * connexion (un appelant qui enchaîne deux transactions sans la rendre). Le
 * pool, lui, ne transmet rien : `mysql2/promise` enveloppe chaque
 * `getConnection()` dans un objet neuf, et la `WeakMap` ne retrouve jamais
 * l'état d'une emprise précédente.
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

/** Toutes les files créées par {@link createTransactionState}, pour {@link clearTransactionStates}. */
const registry = new Set<WeakMap<PoolConnection, unknown>>();

/**
 * Efface, pour cette connexion, l'état de **toutes** les files créées ici —
 * appelée en fin de `flushBotLogs` (après que chaque file a pris le sien) et de
 * `discardBotLogs` : rien ne reste pour une transaction suivante sur le même
 * objet connexion (voir le module — le pool, lui, en rend un neuf). Une file
 * qui y est encore garnie est signalée au journal (`console.error`) : l'oubli
 * de branchement se voit, il ne se perd pas en silence.
 */
export function clearTransactionStates(connection: PoolConnection): void {
  let forgotten = 0;
  for (const states of registry) {
    if (states.delete(connection)) forgotten += 1;
  }
  // Le filet rattrape un oubli, il ne le tait pas : une file encore garnie ici
  // n'a été ni vidée ni jetée par son module, un branchement manque dans
  // `flushBotLogs` / `discardBotLogs` — au journal, pas en silence.
  if (forgotten > 0) {
    console.error(`[transaction-state] ${forgotten} file(s) après commit non branchée(s) à flushBotLogs / discardBotLogs, état jeté`);
  }
}

/**
 * Crée l'état « après commit » d'un module.
 *
 * @param create État vide d'une transaction (au premier `ensure`).
 * @returns L'état, indexé par connexion.
 */
export function createTransactionState<S>(create: () => S): TransactionState<S> {
  const states = new WeakMap<PoolConnection, S>();
  registry.add(states);
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
