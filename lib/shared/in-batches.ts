/**
 * Exécute `run` sur chaque élément, `size` à la fois au plus : une réserve de
 * `size` exécutants prend l'élément suivant dès qu'il en termine un — un envoi
 * lent (un bot qui attend son délai) n'immobilise pas les autres places.
 *
 * Assez pour ne pas attendre chaque aller-retour réseau l'un après l'autre,
 * assez borné pour ne pas noyer le Raspberry Pi (ni le bot) sous des centaines
 * de requêtes simultanées. Un élément en échec ne retient pas les autres : tous
 * passent, puis la première erreur est levée — aucun exécutant n'est laissé
 * en cours sans que personne ne l'attende.
 */
export async function inBatches<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await run(item);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(size, 1), items.length) }, worker));
  if (failures.length > 0) throw failures[0];
}

/**
 * {@link inBatches} qui rend un résultat par élément, à sa place : l'ordre des
 * résultats est celui des éléments, quel que soit celui des fins.
 *
 * @param items Éléments à traiter.
 * @param size Exécutants en même temps, au plus.
 * @param run Traitement d'un élément.
 * @returns Les résultats, dans l'ordre des éléments.
 */
export async function mapInBatches<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  await inBatches(
    items.map((item, index) => ({ item, index })),
    size,
    async ({ item, index }) => {
      results[index] = await run(item);
    },
  );
  return results;
}

/**
 * Tâche passée par un {@link createLimiter}. Une tâche `urgent` passe devant toutes
 * les tâches ordinaires qui attendent (premier arrivé, premier servi entre urgentes) ;
 * elle n'interrompt jamais une tâche déjà en cours.
 */
export type Limited = <R>(task: () => Promise<R>, urgent?: boolean) => Promise<R>;

/**
 * Borne partagée : au plus `size` tâches en cours à la fois pour **tous** les
 * appelants qui passent par la fonction rendue, les autres attendent leur tour
 * (premier arrivé, premier servi, les urgentes d'abord). Une tâche qui échoue rend
 * sa place aussi.
 *
 * @param size Tâches en même temps, au plus (au moins une).
 * @returns Fonction qui exécute une tâche dès qu'une place se libère.
 */
export function createLimiter(size: number): Limited {
  const capacity = Math.max(size, 1);
  let active = 0;
  const waitingUrgent: (() => void)[] = [];
  const waiting: (() => void)[] = [];
  const release = (): void => {
    const next = waitingUrgent.shift() ?? waiting.shift();
    if (next) {
      next();
    } else {
      active -= 1;
    }
  };
  return async <R>(task: () => Promise<R>, urgent = false): Promise<R> => {
    if (active < capacity) {
      active += 1;
    } else {
      // La place passe directement de la tâche qui finit à celle-ci : `active` ne bouge pas.
      await new Promise<void>((resolve) => (urgent ? waitingUrgent : waiting).push(resolve));
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/**
 * Rejette si `promise` ne s'est pas réglée en `ms` : qui l'attend (et la place
 * d'un {@link createLimiter} qu'elle tient) n'attend pas une requête qui ne
 * reviendra jamais. La promesse elle-même continue ; son résultat tardif est perdu.
 *
 * @param promise Promesse à borner.
 * @param ms Délai (ms).
 * @returns Le résultat de `promise`, ou un rejet `TimeoutError` passé le délai.
 */
export function withTimeout<R>(promise: Promise<R>, ms: number): Promise<R> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`délai de ${ms} ms dépassé`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
    // Côté serveur, la borne seule ne retient pas le processus (arrêt, fin des tests).
    if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
  });
  // Un rejet tardif de la promesse abandonnée ne doit pas remonter en rejet non géré.
  promise.catch(() => undefined);
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
