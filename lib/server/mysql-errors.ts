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
 * `true` si la migration n'avait **rien à faire** : la colonne visée existe
 * déjà, ou n'existe plus.
 *
 * C'est le cas nominal des migrations de `lib/server/database.ts`, rejouées à
 * chaque démarrage, et le **seul** qu'un `catch` a le droit d'avaler. Tout
 * autre échec — droit `ALTER` manquant, verrou de métadonnées sur une table
 * chaude — laisse le schéma dans un état que le code ne suppose plus : la base
 * démarre, et la panne se lit plus tard sur une requête qui nomme la colonne.
 *
 * Le distinguer n'est pas de la coquetterie sur un `DROP` : la colonne
 * `bg_users.email` est retirée **pour effacer les adresses**, et un échec avalé
 * les garde indéfiniment sans que rien ne le dise, l'anonymisation ne les
 * effaçant plus non plus.
 */
export function isSchemaNoOpError(error: unknown): boolean {
  const code = errorCode(error);
  return (
    // La colonne à ajouter existe déjà.
    code === "ER_DUP_FIELDNAME" ||
    // La colonne à retirer n'existe pas (ou l'index n'existe pas).
    code === "ER_CANT_DROP_FIELD_OR_KEY" ||
    // L'index unique posé avec la colonne existe déjà.
    code === "ER_DUP_KEYNAME"
  );
}
