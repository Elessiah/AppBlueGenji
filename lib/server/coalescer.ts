/**
 * Regroupe une rafale de gestes de même clé en **une** annonce : chaque
 * nouveau geste relance un silence de `windowMs` ; l'annonce part quand il
 * échoit, ou au plus tard `maxAgeMs` après le premier geste de la rafale (un
 * geste répété sans fin finit quand même par s'annoncer). `deliver` reçoit le
 * premier et le dernier geste de la rafale, et décide de ce qui part.
 *
 * Sert au journal du staff (`docs/features/STAFF_ACTION_LOGS.md`,
 * `docs/features/CAST_NOTICES.md`) : une équipe montée de quinze crans, un
 * caster qui bascule son inscription en boucle, ne remplissent plus le salon.
 *
 * L'état est en mémoire : l'arrêt propre du serveur annonce les rafales en
 * attente ({@link flushAllCoalescers}, appelé par `bot-log-shutdown.ts` avant
 * les lots du journal) ; un arrêt brutal perd au plus la rafale en cours. Les
 * minuteurs sont `unref()` : ils ne retiennent jamais le processus.
 */
type Timer = ReturnType<typeof setTimeout>;

export interface Coalescer<T> {
  /** Note un geste de la rafale `key` ; ne lève jamais, n'attend rien. */
  add(key: string, value: T): void;
  /** Rafales en attente. Lecture seule, pour les tests et le diagnostic. */
  pending(): number;
  /** Annonce tout de suite la rafale `key`, s'il y en a une : un geste qui ne se
   * regroupe pas part ainsi **après** la rafale qu'il suit, jamais avant. */
  flush(key: string): Promise<void>;
  /** Annonce tout de suite toutes les rafales en attente ; se résout une fois
   * les annonces parties (ou échouées). */
  flushAll(): Promise<void>;
  /** Abandonne les rafales sans les annoncer. Réservé aux tests. */
  reset(): void;
}

/** Tous les regroupeurs du processus, pour l'arrêt du serveur. */
const registry = new Set<Coalescer<unknown>>();

export function createCoalescer<T>(options: {
  windowMs: number;
  maxAgeMs: number;
  deliver: (first: T, last: T) => void | Promise<void>;
}): Coalescer<T> {
  type Burst = { first: T; last: T; startedAt: number; timer: Timer };
  const bursts = new Map<string, Burst>();

  const fail = (error: unknown) => {
    console.error("[coalescer] annonce regroupée non partie", error instanceof Error ? error.message : "erreur inconnue");
  };

  const fire = async (key: string): Promise<void> => {
    const burst = bursts.get(key);
    if (!burst) return;
    clearTimeout(burst.timer);
    bursts.delete(key);
    try {
      await options.deliver(burst.first, burst.last);
    } catch (error) {
      fail(error);
    }
  };

  const arm = (key: string, delay: number): Timer => {
    const timer = setTimeout(() => void fire(key), Math.max(0, delay));
    timer.unref?.();
    return timer;
  };

  const coalescer: Coalescer<T> = {
    add(key, value) {
      const now = Date.now();
      const burst = bursts.get(key);
      if (!burst) {
        bursts.set(key, { first: value, last: value, startedAt: now, timer: arm(key, options.windowMs) });
        return;
      }
      clearTimeout(burst.timer);
      burst.last = value;
      const left = burst.startedAt + options.maxAgeMs - now;
      burst.timer = arm(key, Math.min(options.windowMs, left));
    },
    pending: () => bursts.size,
    flush: (key) => fire(key),
    async flushAll() {
      await Promise.all([...bursts.keys()].map((key) => fire(key)));
    },
    reset() {
      for (const burst of bursts.values()) clearTimeout(burst.timer);
      bursts.clear();
    },
  };
  registry.add(coalescer);
  return coalescer;
}

/** Annonce les rafales de tous les regroupeurs (arrêt du serveur). Ne lève jamais. */
export async function flushAllCoalescers(): Promise<void> {
  await Promise.all([...registry].map((coalescer) => coalescer.flushAll()));
}
