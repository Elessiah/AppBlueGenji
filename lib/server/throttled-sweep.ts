import { outboundMuted } from "@/lib/server/outbound-mute";

/**
 * Étranglement à relève des balayages de notifications (départs de match,
 * brief du salon) : un balayage au plus toutes les `throttleMs`, et un appel
 * étranglé — ou arrivé pendant un balayage déjà parti, dont la lecture a pu
 * précéder l'écriture qui vient d'avoir lieu — n'est pas **perdu** : un seul
 * minuteur, détaché du processus (`unref`), rejoue le balayage une fois le
 * délai écoulé.
 *
 * Jamais une exception : `sweep` qui lève est confiée à `onError`, et l'appel
 * rend `0`.
 *
 * Envois coupés (rejeu d'une restauration, `outbound-mute.ts`) : aucun
 * balayage ne part. Un balayage **réserve** chaque notification avant de
 * l'envoyer ; réservée sans envoi possible, elle serait perdue pour de bon.
 */
export type ThrottledSweep = {
  /** Lance le balayage s'il est dû ; sinon arme la relève. Rend ce que le balayage a compté. */
  run(): Promise<number>;
  /** Arme la relève dans `delayMs` (au plus un minuteur à la fois). */
  schedule(delayMs: number): void;
  /** Remet l'étranglement à zéro. Réservé aux tests. */
  reset(): void;
};

export function throttledSweep(options: {
  throttleMs: number;
  sweep: () => Promise<number>;
  onError: (error: unknown) => void;
  /**
   * Garde relue à **chaque** passage, relève comprise : faux, rien ne part
   * (ni balayage ni minuteur) et l'appel rend `0`.
   */
  enabled?: () => boolean;
}): ThrottledSweep {
  const enabled = (): boolean => !outboundMuted() && (options.enabled?.() ?? true);
  let lastSweepAt = 0;
  let pending: Promise<number> | null = null;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;

  function schedule(delayMs: number): void {
    // Garde fausse (envois coupés compris) : aucun minuteur ne s'arme.
    if (trailingTimer || !enabled()) return;
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      void run();
    }, Math.max(0, delayMs));
    trailingTimer.unref?.();
  }

  async function run(): Promise<number> {
    if (!enabled()) return 0;
    if (pending) {
      schedule(options.throttleMs);
      return pending;
    }
    const sinceLast = Date.now() - lastSweepAt;
    if (sinceLast < options.throttleMs) {
      schedule(options.throttleMs - sinceLast);
      return 0;
    }
    pending = (async () => {
      try {
        return await options.sweep();
      } catch (error) {
        options.onError(error);
        return 0;
      }
    })();
    try {
      return await pending;
    } finally {
      lastSweepAt = Date.now();
      pending = null;
    }
  }

  function reset(): void {
    lastSweepAt = 0;
    pending = null;
    if (trailingTimer) clearTimeout(trailingTimer);
    trailingTimer = null;
  }

  return { run, schedule, reset };
}
