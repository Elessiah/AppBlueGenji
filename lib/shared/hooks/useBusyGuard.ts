"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runExclusive } from "@/lib/shared/busy-guard";

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
   * renverrait la requête. Sans retour : `busy` et `isBusy()` restent vrais.
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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
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
    heldRef.current = true;
    if (mounted.current) setHeld(true);
  }, []);
  const shown = busy || held;
  return useMemo(() => ({ busy: shown, isBusy, run, isMounted, hold }), [shown, isBusy, run, isMounted, hold]);
}
