"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runExclusive } from "@/lib/shared/busy-guard";

/** Lance une tâche si aucun envoi n'est en cours (`runExclusive`). */
export type BusyRun = <T>(task: () => Promise<T>) => Promise<T | undefined>;

/** Attributs d'un bouton pendant l'envoi : focalisable, annoncé en attente. */
export type BusyProps = { "aria-disabled": true | undefined; "aria-busy": true | undefined };

export type BusyGuard = {
  /** État rendu : `aria-disabled` / `aria-busy` des boutons. */
  busy: boolean;
  /** État synchrone, juste, même avant le rendu : la garde des gestionnaires. */
  isBusy: () => boolean;
  run: BusyRun;
  /** `aria-disabled` + `aria-busy` à étaler sur un bouton d'envoi. */
  busyProps: BusyProps;
};

const IDLE_PROPS: BusyProps = { "aria-disabled": undefined, "aria-busy": undefined };
const BUSY_PROPS: BusyProps = { "aria-disabled": true, "aria-busy": true };

/**
 * Un envoi à la fois pour un écran (`lib/shared/busy-guard.ts`,
 * `docs/features/BUSY_BUTTONS.md`) : `busy` pour l'affichage, `isBusy()` pour
 * ignorer un geste parti avant le rendu, `run(task)` pour envoyer.
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
  const run = useCallback<BusyRun>((task) => runExclusive(flag, setBusy, task), [setBusy]);
  return useMemo(() => ({ busy, isBusy, run, busyProps: busy ? BUSY_PROPS : IDLE_PROPS }), [busy, isBusy, run]);
}
