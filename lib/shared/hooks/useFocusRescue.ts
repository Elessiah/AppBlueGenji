"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { isFocusLost } from "@/lib/shared/focus-lost";
import {
  FOCUS_RESCUE_WINDOW_MS,
  pickRescueTarget,
  rescueDue,
  rescueExpired,
  type FocusRescue,
} from "@/lib/shared/focus-rescue";

// `useLayoutEffect` ne fait rien au rendu serveur : le secours ne suit qu'un geste.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Rend le focus dans `rootRef` quand le bouton pressé a disparu
 * (`lib/shared/focus-rescue.ts`). `arm(sélecteurs)` se pose au succès du
 * geste ; à chaque rendu qui suit (relecture de la fiche), **avant la
 * peinture**, si le focus est tombé sur la page, il va à la première cible
 * trouvée — jamais s'il est parti ailleurs, jamais passé `FOCUS_RESCUE_WINDOW_MS`.
 * Le premier focus rendu consomme la demande. Rien n'est relu sans demande.
 */
export function useFocusRescue(rootRef: RefObject<HTMLElement | null>): (selectors: readonly string[]) => void {
  const pending = useRef<FocusRescue | null>(null);
  useIsomorphicLayoutEffect(() => {
    const rescue = pending.current;
    if (rescue === null) return;
    const now = Date.now();
    if (rescueExpired(rescue, now)) {
      pending.current = null;
      return;
    }
    if (!rescueDue(rescue, now, isFocusLost(document))) return;
    const target = pickRescueTarget(rootRef.current, rescue.selectors);
    if (target === null) return;
    pending.current = null;
    target.focus();
  });
  return useCallback((selectors: readonly string[]) => {
    pending.current = { until: Date.now() + FOCUS_RESCUE_WINDOW_MS, selectors };
  }, []);
}
