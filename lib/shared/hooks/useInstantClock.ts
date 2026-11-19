"use client";

import { useEffect, useState } from "react";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";

/** Délai le plus long que `setTimeout` accepte sans se déclencher aussitôt. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * La prochaine frontière à surveiller après `now` : l'instant `at - leadMs`
 * (s'il est encore devant) puis `at` lui-même ; `null` quand `at` est absent
 * ou atteint (pur, testé sans rendu).
 */
export function nextInstantBoundary(now: number, at: number | null, leadMs: number = 0): number | null {
  if (at === null || now >= at) return null;
  const lead = at - Math.max(0, leadMs);
  return now < lead ? lead : at;
}

/**
 * L'instant courant, relu quand l'instant `at` (ms) est atteint — et, si
 * `leadMs` est donné, une première fois `leadMs` avant (« moins de 24 h
 * avant ») : au plus deux `setTimeout` successifs, aucun battement ; ce qu'un
 * écran en déduit ne change qu'à ces frontières. Rien n'est posé quand `at`
 * est absent ou déjà passé, et l'horloge n'est même pas lue sans `at`.
 *
 * Soumise au régime de charge comme `useClock` (`useClientPower().clocks`) :
 * onglet caché, aucun minuteur ne reste posé ; au retour, l'heure est relue
 * **aussitôt** (une frontière franchie pendant l'absence se voit tout de suite).
 *
 * `null` avant le montage (ou sans `at`) : l'heure du serveur n'est pas celle
 * du lecteur, et la rendre au premier passage ferait diverger l'hydratation.
 */
export function useInstantClock(at: number | null, leadMs: number = 0): number | null {
  const { clocks } = useClientPower();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (at === null) return;
    setNow(Date.now());
  }, [at, clocks]);

  useEffect(() => {
    if (now === null || !clocks) return;
    const boundary = nextInstantBoundary(now, at, leadMs);
    if (boundary === null) return;
    // `setTimeout` sature au-delà de ~24,8 jours (déclenchement immédiat) : délai plafonné. Un réveil
    // avant la frontière (plafond, minuteur en avance) relit l'heure réelle et repose le minuteur :
    // l'écran ne bascule jamais avant l'instant.
    const delay = Math.min(Math.max(0, boundary - Date.now()), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [at, clocks, leadMs, now]);

  return now;
}
