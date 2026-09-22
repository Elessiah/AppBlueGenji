/**
 * Reconnaître les erreurs MySQL qu'on a le droit d'ignorer — et surtout celles
 * qu'on n'a pas le droit d'ignorer.
 *
 * Le projet avale volontiers les échecs des chemins de notification : une
 * alerte perdue vaut mieux qu'un report de score en erreur. Mais un `catch`
 * large y devient dangereux, parce que toutes les erreurs MySQL n'ont pas la
 * même portée : un **interblocage** (`ER_LOCK_DEADLOCK`) fait annuler par InnoDB
 * la **transaction entière**, pas seulement la requête. L'avaler laisserait le
 * moteur poursuivre — propager une qualifiée, commiter — sur une transaction
 * déjà défaite, et rendre un 200 pour une écriture qui n'existe plus.
 */

/** Code d'erreur mysql2, quand l'objet en porte un. */
function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * `true` si l'erreur a fait **annuler la transaction en cours** par le serveur.
 *
 * Le seul cas en pratique est l'interblocage : MySQL choisit une victime et la
 * défait entièrement. Un dépassement de délai de verrou
 * (`ER_LOCK_WAIT_TIMEOUT`) n'annule, lui, que la requête —
 * `innodb_rollback_on_timeout` est désactivé par défaut —, et n'a donc pas à
 * interrompre l'appelant.
 */
export function isTransactionAborted(error: unknown): boolean {
  return errorCode(error) === "ER_LOCK_DEADLOCK";
}

/**
 * `true` si la table n'existe pas.
 *
 * Les migrations de `lib/server/database.ts` créent chaque table dans un `try`
 * dont le `catch` est muet : une base où l'une d'elles a échoué reste debout,
 * et les chemins accessoires — notifications, réservations d'alerte — doivent
 * pouvoir s'en accommoder plutôt que d'emporter la fonctionnalité qui les
 * appelle.
 */
export function isMissingTableError(error: unknown): boolean {
  return errorCode(error) === "ER_NO_SUCH_TABLE";
}

/**
 * `true` si l'écriture a buté sur une contrainte d'unicité.
 *
 * Le motif est toujours le même dans ce projet : un `SELECT` préalable donne le
 * refus **lisible** (« ce tag est déjà certifié »), l'index unique tranche la
 * **course** entre deux écritures simultanées que ce `SELECT` ne peut pas voir.
 * Les deux ne font pas double emploi, et c'est cette seconde moitié que le
 * prédicat sert à traduire.
 *
 * Il ne dit **pas laquelle** des contraintes a cédé : une table qui en porte
 * plusieurs (`bg_teams` : le nom et le sigle) doit lire le nom de l'index, ce
 * que fait `mapTeamTagConflict`. Là où il n'y en a qu'une, ce prédicat suffit.
 */
export function isDuplicateEntryError(error: unknown): boolean {
  return errorCode(error) === "ER_DUP_ENTRY";
}

/**
 * `true` si une clé étrangère en `RESTRICT` a refusé l'effacement d'une ligne
 * encore référencée.
 *
 * Le cas est atteignable par une **course** que le code ne peut pas fermer :
 * les contrôles de clé étrangère lisent la dernière version commitée et non
 * l'instantané de la transaction, si bien qu'une ligne créée après la lecture
 * des traces peut retenir une suppression que celle-ci avait jugée possible.
 * Le message brut de MySQL nomme alors la table, la contrainte et la base —
 * il n'a rien à faire dans une notification d'interface.
 */
export function isReferencedRowError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ER_ROW_IS_REFERENCED_2" || code === "ER_ROW_IS_REFERENCED";
}
