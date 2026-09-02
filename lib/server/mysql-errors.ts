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
