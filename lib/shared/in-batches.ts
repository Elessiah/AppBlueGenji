/** Arrêts anticipés de {@link inBatches}, à la demande. */
export type BatchOptions = {
  /** Ne démarre plus aucun élément après le premier échec. */
  failFast?: boolean;
  /** Ne démarre plus aucun élément une fois le signal levé. */
  signal?: AbortSignal;
};

/**
 * Exécute `run` sur chaque élément, `size` à la fois au plus : une réserve de
 * `size` exécutants prend l'élément suivant dès qu'il en termine un — un envoi
 * lent (un bot qui attend son délai) n'immobilise pas les autres places.
 *
 * Assez pour ne pas attendre chaque aller-retour réseau l'un après l'autre,
 * assez borné pour ne pas noyer le Raspberry Pi (ni le bot) sous des centaines
 * de requêtes simultanées. Un élément en échec ne retient pas les autres : tous
 * passent, puis la première erreur est levée — aucun exécutant n'est laissé
 * en cours sans que personne ne l'attende. Deux arrêts, à la demande
 * ({@link BatchOptions}) : `failFast` (une base qui échoue ne reçoit pas les
 * requêtes qui suivent, vouées à échouer aussi) et `signal` (le résultat
 * n'intéresse plus personne : ce qui est en cours finit, rien de nouveau ne démarre).
 */
export async function inBatches<T>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<void>,
  options: BatchOptions = {},
): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const stopped = (): boolean => (options.failFast === true && failures.length > 0) || options.signal?.aborted === true;
  const worker = async (): Promise<void> => {
    while (next < items.length && !stopped()) {
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
 * résultats est celui des éléments, quel que soit celui des fins. Un arrêt demandé
 * (`options`) laisse vides les places des éléments jamais démarrés.
 *
 * @param items Éléments à traiter.
 * @param size Exécutants en même temps, au plus.
 * @param run Traitement d'un élément.
 * @param options Arrêts anticipés ({@link BatchOptions}).
 * @returns Les résultats, dans l'ordre des éléments.
 */
export async function mapInBatches<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
  options: BatchOptions = {},
): Promise<R[]> {
  const results = new Array<R>(items.length);
  await inBatches(
    items.map((item, index) => ({ item, index })),
    size,
    async ({ item, index }) => {
      results[index] = await run(item);
    },
    options,
  );
  return results;
}

/**
 * Tâche passée par un {@link createLimiter}. Une tâche `urgent` passe devant les
 * tâches ordinaires qui attendent (premier arrivé, premier servi entre urgentes),
 * sans en affamer aucune : après {@link URGENT_STREAK_MAX} urgentes de suite, une
 * ordinaire qui attend prend la place. Elle n'interrompt jamais une tâche en cours.
 */
export type Limited = <R>(task: () => Promise<R>, urgent?: boolean) => Promise<R>;

/** Urgentes servies de suite avant qu'une tâche ordinaire en attente ait son tour. */
export const URGENT_STREAK_MAX = 8;

/** Rejet d'une tâche ordinaire que la file d'attente, pleine, ne reçoit pas. */
export class LimiterFullError extends Error {
  constructor(waiting: number) {
    super(`file d'attente pleine (${waiting} tâches)`);
    this.name = "LimiterFullError";
  }
}

/**
 * Borne partagée : au plus `size` tâches en cours à la fois pour **tous** les
 * appelants qui passent par la fonction rendue, les autres attendent leur tour
 * (premier arrivé, premier servi, les urgentes d'abord). Une tâche qui échoue rend
 * sa place aussi. Avec `maxWaiting`, une tâche ordinaire qui trouverait déjà autant
 * de tâches en attente est refusée (`LimiterFullError`) : la file, et les fermetures
 * qu'elle retient, ne croissent pas sans fin pendant une panne. Une urgente est
 * toujours reçue.
 *
 * @param size Tâches en même temps, au plus (au moins une).
 * @param maxWaiting Tâches ordinaires en attente, au plus (sans borne par défaut).
 * @returns Fonction qui exécute une tâche dès qu'une place se libère.
 */
export function createLimiter(size: number, maxWaiting: number = Number.POSITIVE_INFINITY): Limited {
  const capacity = Math.max(size, 1);
  let active = 0;
  let urgentStreak = 0;
  const waitingUrgent: (() => void)[] = [];
  const waiting: (() => void)[] = [];
  const nextWaiter = (): (() => void) | undefined => {
    const ordinaryTurn = waiting.length > 0 && urgentStreak >= URGENT_STREAK_MAX;
    if (!ordinaryTurn && waitingUrgent.length > 0) {
      urgentStreak += 1;
      return waitingUrgent.shift();
    }
    urgentStreak = 0;
    return waiting.shift();
  };
  const release = (): void => {
    const next = nextWaiter();
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
      if (!urgent && waiting.length >= maxWaiting) throw new LimiterFullError(waiting.length);
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
 * Lance `task` et rejette si elle ne s'est pas réglée en `ms` : qui l'attend (et la
 * place d'un {@link createLimiter} qu'elle tient) n'attend pas une requête qui ne
 * reviendra jamais. Au délai, le signal passé à `task` est levé : la tâche, qui le
 * lit, ne démarre plus de travail nouveau ({@link BatchOptions}) — ce qui est déjà
 * parti ne peut pas être repris, et son résultat tardif est perdu.
 *
 * @param task Travail à borner, qui reçoit le signal d'abandon.
 * @param ms Délai (ms).
 * @returns Le résultat de `task`, ou un rejet `TimeoutError` passé le délai.
 */
export function withDeadline<R>(task: (signal: AbortSignal) => Promise<R>, ms: number): Promise<R> {
  const controller = new AbortController();
  // Une tâche qui lève sans rendre de promesse devient une promesse rejetée : la course
  // se règle aussitôt et `finally` désarme le délai, qui ne rejette donc jamais tard.
  const promise = (async () => task(controller.signal))();
  // Un rejet tardif de la promesse abandonnée ne doit pas remonter en rejet non géré.
  promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error(`délai de ${ms} ms dépassé`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
    // Côté serveur, la borne seule ne retient pas le processus (arrêt, fin des tests).
    if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Compte borné de travaux **en cours**, y compris ceux qu'un délai a abandonnés sans
 * que leur requête soit revenue. Un travail dont l'horloge d'abandon a été lancée
 * (`expire`, au délai de l'appelant) et qui reste compté au-delà de `abandonAfterMs`
 * est oublié (`onForgotten`) : il ne prend plus de place parmi les `max`, et une requête
 * qui tarde (connexion à moitié ouverte) ne retient pas tout jusqu'au redémarrage. Mais
 * il tient encore sa connexion : il reste compté dans le plafond `unsettledMax` des
 * travaux non revenus (comptés + oubliés) jusqu'à son vrai retour — un abandon ne fait
 * jamais dépasser ce plafond.
 */
export type InFlightGate = {
  /**
   * Compte un travail s'il reste une place (parmi `max` et sous le plafond `unsettledMax`).
   * @returns Le ticket du travail, ou `null` si tout est pris.
   */
  tryEnter(): InFlightTicket | null;
  /** Travaux comptés en ce moment (oubliés exclus). */
  readonly count: number;
  /** Travaux oubliés dont le retour n'est pas encore arrivé. */
  readonly forgotten: number;
};

/** Ticket d'un travail compté par un {@link InFlightGate}. */
export type InFlightTicket = {
  /** Le travail est revenu (sans effet après le premier appel). */
  leave(): void;
  /** Le délai de l'appelant est passé : lance l'horloge d'abandon (une fois). */
  expire(): void;
};

/**
 * Crée un {@link InFlightGate}.
 *
 * @param max Travaux comptés en même temps, au plus.
 * @param abandonAfterMs Durée, après `expire`, au-delà de laquelle un travail encore compté est oublié.
 * @param onForgotten Appelé quand un travail est oublié ainsi (journal).
 * @param unsettledMax Travaux non revenus (comptés + oubliés), au plus.
 * @returns Le compte.
 */
export function createInFlightGate(
  max: number,
  abandonAfterMs: number,
  onForgotten: () => void = () => undefined,
  unsettledMax: number = Number.POSITIVE_INFINITY,
): InFlightGate {
  let count = 0;
  let forgotten = 0;
  return {
    get count() {
      return count;
    },
    get forgotten() {
      return forgotten;
    },
    tryEnter() {
      if (count >= max || count + forgotten >= unsettledMax) return null;
      count += 1;
      let state: "counted" | "forgotten" | "left" = "counted";
      let timer: ReturnType<typeof setTimeout> | undefined;
      return {
        leave() {
          if (state === "left") return;
          if (state === "counted") count -= 1;
          else forgotten -= 1;
          state = "left";
          clearTimeout(timer);
        },
        expire() {
          if (state !== "counted" || timer !== undefined) return;
          timer = setTimeout(() => {
            if (state !== "counted") return;
            state = "forgotten";
            count -= 1;
            forgotten += 1;
            onForgotten();
          }, abandonAfterMs);
          if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
        },
      };
    },
  };
}
