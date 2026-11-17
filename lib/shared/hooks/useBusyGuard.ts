"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runExclusive } from "@/lib/shared/busy-guard";

/** Délai après lequel un écran tenu (`hold`) dont la navigation n'a pas abouti est rendu. */
export const HOLD_RELEASE_MS = 20_000;

/** Lance une tâche si aucun envoi n'est en cours (`runExclusive`). */
export type BusyRun = <T>(task: () => Promise<T>) => Promise<T | undefined>;

export type BusyGuard = {
  /** État rendu : `aria-disabled` / `aria-busy` des boutons. */
  busy: boolean;
  /** État synchrone, juste, même avant le rendu : la garde des gestionnaires. */
  isBusy: () => boolean;
  run: BusyRun;
  /** L'écran est-il encore monté ? Pour ne pas relancer un geste après sa fermeture. */
  isMounted: () => boolean;
  /**
   * Garde l'écran en attente **après** la fin de l'envoi, jusqu'à son démontage :
   * pour un geste réussi suivi d'une navigation (création, suppression), qui
   * laisse l'écran monté le temps du `router.push` — un second clic y
   * renverrait la requête. `busy` et `isBusy()` restent vrais jusqu'au
   * démontage — ou, si la navigation n'aboutit pas (réseau coupé, redirection
   * vers la même page), jusqu'à `HOLD_RELEASE_MS` : l'écran se rend alors à
   * l'utilisateur au lieu de rester gelé.
   */
  hold: () => void;
};

/**
 * Un envoi à la fois pour un écran (`lib/shared/busy-guard.ts`,
 * `docs/features/BUSY_BUTTONS.md`) : `busy` pour l'affichage, `isBusy()` pour
 * ignorer un geste parti avant le rendu, `run(task)` pour envoyer. Les boutons
 * passent par `<BusyButton busy={busy}>` (`components/ui/busy-button.tsx`), qui
 * pose `aria-disabled` / `aria-busy` et annule l'activation d'un même état.
 *
 * Rien d'inutile à chaque rendu : l'objet rendu est mémoïsé (il ne change qu'à
 * l'entrée et à la sortie d'un envoi, jamais à la frappe), les rappels sont
 * stables, la garde est un `useRef`. L'écran démonté pendant un envoi (la tâche
 * ferme souvent son propre dialogue) ne reçoit plus de mise à jour d'état ; la
 * requête, elle, va à son terme — elle ne s'annule pas.
 */
export function useBusyGuard(): BusyGuard {
  const [busy, setBusyState] = useState(false);
  const [held, setHeld] = useState(false);
  const flag = useRef(false);
  const heldRef = useRef(false);
  const mounted = useRef(true);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (releaseTimer.current !== null) clearTimeout(releaseTimer.current);
    };
  }, []);
  const setBusy = useCallback((next: boolean) => {
    if (mounted.current) setBusyState(next);
  }, []);
  const isBusy = useCallback(() => flag.current || heldRef.current, []);
  const isMounted = useCallback(() => mounted.current, []);
  // Écran tenu (`hold`) : plus aucun envoi ne part, même d'un appelant qui
  // n'aurait pas consulté `isBusy()`.
  const run = useCallback<BusyRun>(
    (task) => (heldRef.current ? Promise.resolve(undefined) : runExclusive(flag, setBusy, task)),
    [setBusy],
  );
  const hold = useCallback(() => {
    // Écran déjà démonté (la navigation a été plus vite) : rien à tenir, et
    // aucune minuterie que le démontage ne viendrait plus effacer.
    if (!mounted.current) return;
    heldRef.current = true;
    setHeld(true);
    if (releaseTimer.current !== null) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      releaseTimer.current = null;
      heldRef.current = false;
      if (mounted.current) setHeld(false);
    }, HOLD_RELEASE_MS);
  }, []);
  const shown = busy || held;
  return useMemo(() => ({ busy: shown, isBusy, run, isMounted, hold }), [shown, isBusy, run, isMounted, hold]);
}
