"use client";

import { useEffect, useState } from "react";

/** Délai le plus long que `setTimeout` accepte sans se déclencher aussitôt. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * L'instant courant, relu **une seule fois** quand l'instant `at` (ms) est
 * atteint — un `setTimeout`, aucun battement : ce qu'un écran en déduit
 * (« avant / après `at` ») ne change qu'à cette frontière. Rien n'est posé
 * quand `at` est absent ou déjà passé.
 *
 * `null` avant le montage : l'heure du serveur n'est pas celle du lecteur, et
 * la rendre au premier passage ferait diverger l'hydratation.
 */
export function useInstantClock(at: number | null): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, [at]);

  useEffect(() => {
    if (at === null || now === null || now >= at) return;
    // `setTimeout` sature au-delà de ~24,8 jours (déclenchement immédiat) : délai plafonné. Un réveil
    // avant `at` (plafond, minuteur en avance) relit l'heure réelle et repose le minuteur : l'écran ne
    // bascule jamais avant l'instant.
    const delay = Math.min(Math.max(0, at - Date.now()), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [at, now]);

  return now;
}
