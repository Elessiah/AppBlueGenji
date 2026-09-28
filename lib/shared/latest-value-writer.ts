/**
 * Écritures **en série** d'une valeur dont seule la dernière compte.
 *
 * Un réglage qui s'envoie en entier à chaque geste (la liste des sujets de
 * notification coupés, par exemple) ne supporte pas deux requêtes en parallèle :
 * la plus ancienne peut être écrite en dernier et contredire l'écran. Ici, une
 * écriture attend la précédente, et envoie la valeur **voulue à son tour** — si
 * trois gestes arrivent pendant qu'une écriture est en vol, une seule suit, avec
 * le dernier, et les trois gestes suivent son issue.
 *
 * Module pur : aucune dépendance au navigateur, testable tel quel.
 */
export function createLatestValueWriter<T>(write: (value: T) => Promise<void>): {
  /** Demande l'écriture de `value` ; la promesse suit l'écriture qui la porte. */
  submit: (value: T) => Promise<void>;
} {
  let desired: T;
  /** L'écriture en attente de partir, que les gestes suivants rejoignent. */
  let queued: Promise<void> | null = null;
  let chain: Promise<void> = Promise.resolve();

  return {
    submit(value: T): Promise<void> {
      desired = value;
      // Une écriture attend déjà son tour : elle partira avec cette valeur, et
      // ce geste suit **son** issue — succès comme échec.
      if (queued) return queued;
      const run = chain.then(async () => {
        queued = null;
        await write(desired);
      });
      queued = run;
      // Un échec n'empêche pas la suite de la file de partir.
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
