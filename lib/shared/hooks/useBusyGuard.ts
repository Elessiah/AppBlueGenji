"use client";

import { useCallback, useRef, useState } from "react";
import { runExclusive } from "@/lib/shared/busy-guard";

/** Lance une tâche si aucun envoi n'est en cours (`runExclusive`). */
export type BusyRun = <T>(task: () => Promise<T>) => Promise<T | undefined>;

export type BusyGuard = {
  /** État rendu : `aria-disabled` / `aria-busy` des boutons. */
  busy: boolean;
  /** État synchrone, juste même avant le rendu : la garde des gestionnaires. */
  isBusy: () => boolean;
  run: BusyRun;
};

/**
 * Un envoi à la fois pour un écran (`lib/shared/busy-guard.ts`,
 * `docs/features/BUSY_BUTTONS.md`) : `busy` pour l'affichage, `isBusy()` pour
 * ignorer un geste parti avant le rendu, `run(task)` pour envoyer.
 */
export function useBusyGuard(): BusyGuard {
  const [busy, setBusy] = useState(false);
  const flag = useRef(false);
  const isBusy = useCallback(() => flag.current, []);
  const run = useCallback<BusyRun>((task) => runExclusive(flag, setBusy, task), []);
  return { busy, isBusy, run };
}
