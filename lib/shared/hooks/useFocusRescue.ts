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

/** Gestes du lecteur qui retirent une demande de secours : il a repris la main. */
const USER_INPUT_EVENTS = ["pointerdown", "keydown"] as const;

/**
 * Rend le focus dans `rootRef` quand le bouton pressé a disparu
 * (`lib/shared/focus-rescue.ts`). `arm(sélecteurs)` se pose au succès du
 * geste ; à chaque rendu qui suit (relecture de la fiche), **avant la
 * peinture**, si le focus est tombé sur la page, il va à la première cible
 * trouvée. La demande tombe au premier focus rendu, passé
 * `FOCUS_RESCUE_WINDOW_MS`, et dès que le lecteur **reprend la main** (touche
 * ou pointeur) : un focus perdu plus tard (clic dans le vide, autre geste) ne
 * le ramène jamais à ce geste-ci. Rien n'est relu sans demande.
 */
export function useFocusRescue(rootRef: RefObject<HTMLElement | null>): (selectors: readonly string[]) => void {
  const pending = useRef<FocusRescue | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const clear = useCallback(() => {
    pending.current = null;
    detach.current?.();
    detach.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clear();
    };
  }, [clear]);
  useIsomorphicLayoutEffect(() => {
    const rescue = pending.current;
    if (rescue === null) return;
    const now = Date.now();
    if (rescueExpired(rescue, now)) {
      clear();
      return;
    }
    if (!rescueDue(rescue, now, isFocusLost(document))) return;
    const target = pickRescueTarget(rootRef.current, rescue.selectors);
    if (target === null) return;
    clear();
    target.focus();
  });
  return useCallback(
    (selectors: readonly string[]) => {
      clear();
      // Un geste qui se termine après le démontage ne pose rien : plus aucun rendu ne le retirerait.
      if (!mounted.current) return;
      pending.current = { until: Date.now() + FOCUS_RESCUE_WINDOW_MS, selectors };
      const drop = () => clear();
      for (const type of USER_INPUT_EVENTS) document.addEventListener(type, drop, true);
      // Sans rendu après le geste, rien ne constaterait l'expiration : le délai la porte aussi.
      const timer = setTimeout(drop, FOCUS_RESCUE_WINDOW_MS + 1);
      detach.current = () => {
        clearTimeout(timer);
        for (const type of USER_INPUT_EVENTS) document.removeEventListener(type, drop, true);
      };
    },
    [clear],
  );
}
