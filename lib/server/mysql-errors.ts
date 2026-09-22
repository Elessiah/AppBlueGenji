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
 * Trois tables de `lib/server/database.ts` — et elles seules — sont créées dans
 * un `try` dont le `catch` est muet : `bg_match_reminders`,
 * `bg_referee_alerts` et `bg_endurance_penalties`. Une base où leur création a
 * échoué reste debout, et c'est à leurs lecteurs de s'en accommoder plutôt que
 * d'emporter la fonctionnalité qui les appelle : un rappel perdu vaut mieux
 * qu'un report de score en erreur.
 *
 * **Tous ne le font pas encore**, et ce prédicat ne le garantit pas tout seul :
 * les `DELETE FROM bg_match_reminders` de `tournaments/deletion.ts` et
 * `tournaments/rollback.ts` n'ont pas la garde que portent leurs voisins, si
 * bien qu'une base sans cette table rendrait tout tournoi indélébile. Défaut
 * préexistant, consigné dans `ERREUR.txt`.
 *
 * Les autres tables ne sont **pas** tolérées : le site n'a rien à servir sans
 * elles, et ce prédicat n'a donc pas à couvrir leur absence.
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
 * `true` si la migration n'avait **rien à faire** — au regard de l'instruction
 * qu'elle jouait.
 *
 * C'est le cas nominal des migrations de `lib/server/database.ts`, rejouées à
 * chaque démarrage, et le **seul** qu'un `catch` a le droit d'avaler. Tout autre
 * échec — droit `ALTER` manquant, verrou de métadonnées sur une table chaude —
 * laisse le schéma dans un état que le code ne suppose plus : la base démarre,
 * et la panne se lit plus tard sur une requête qui nomme la colonne.
 *
 * Le distinguer n'est pas de la coquetterie sur un `DROP` : la colonne
 * `bg_users.email` est retirée **pour effacer les adresses**, et un échec avalé
 * les garde indéfiniment sans que rien ne le dise, l'anonymisation ne les
 * effaçant plus non plus.
 *
 * **Le même code ne dit pas la même chose selon l'instruction**, et c'est la
 * raison d'être du second paramètre. `ER_DUP_KEYNAME` en est l'exemple entier :
 *
 * - sur `ADD COLUMN blizzard_sub … UNIQUE`, il ne peut signifier que l'inverse
 *   d'un no-op. MySQL voit la colonne avant l'index et rendrait
 *   `ER_DUP_FIELDNAME` si elle était là ; recevoir `ER_DUP_KEYNAME` dit donc que
 *   la colonne n'a **pas** été ajoutée et qu'un index porte déjà son nom. C'est
 *   une anomalie, et il faut la dire.
 * - sur `ADD UNIQUE INDEX uniq_bg_teams_tag …`, il dit exactement « l'index est
 *   déjà là » — le cas nominal, à chaque démarrage. Le traiter en anomalie
 *   poserait une fausse ligne d'échec à chaque redémarrage, et une alerte
 *   permanente cesse d'être lue : ce serait éroder le signal même qu'on a posé
 *   pour protéger le retrait des adresses.
 *
 * Sans `statement`, seuls les deux codes inconditionnels sont tolérés — le
 * défaut prudent.
 */
export function isSchemaNoOpError(error: unknown, statement?: string): boolean {
  const code = errorCode(error);
  if (code === null) return false;

  // Vrais quelle que soit l'instruction.
  if (code === "ER_DUP_FIELDNAME" || code === "ER_CANT_DROP_FIELD_OR_KEY") return true;
  if (!statement) return false;

  const sql = statement.toUpperCase();
  // « Ajoute une colonne » l'emporte : `ADD COLUMN x … UNIQUE` pose bien un
  // index, mais son no-op se lit sur la colonne, jamais sur l'index.
  const addsColumn =
    /\bADD\s+(?!COLUMN\b)(?!INDEX\b|KEY\b|UNIQUE\b|PRIMARY\b|CONSTRAINT\b|FULLTEXT\b|SPATIAL\b|FOREIGN\b)`?[A-Z_]+`?\s/.test(
      sql,
    ) || /\bADD\s+COLUMN\b/.test(sql);

  if (!addsColumn) {
    // L'index (ou la contrainte unique) existe déjà.
    if (code === "ER_DUP_KEYNAME" && /\bADD\s+(UNIQUE\s+)?(INDEX|KEY)\b/.test(sql)) return true;
    // La table a déjà une clé primaire : la recomposition est faite.
    if (code === "ER_MULTIPLE_PRI_KEY" && /\bADD\s+PRIMARY\s+KEY\b/.test(sql)) return true;
  }

  return false;
}
