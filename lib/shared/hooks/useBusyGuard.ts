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
  const flag = useRef(false);
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
  const isBusy = useCallback(() => flag.current, []);
  const isMounted = useCallback(() => mounted.current, []);
  const run = useCallback<BusyRun>((task) => runExclusive(flag, setBusy, task), [setBusy]);
  return useMemo(() => ({ busy, isBusy, run, isMounted }), [busy, isBusy, run, isMounted]);
}
