"use client";

import { useEffect, useRef } from "react";
import { FOCUS_REFRESH_MIN_INTERVAL_MS } from "@/lib/shared/refresh-tiers";

type AutoRefreshOptions = {
  /** Période du rafraîchissement de fond, en millisecondes. */
  intervalMs: number;
  /** Désactive tout (page sans donnée à rafraîchir, chargement initial en cours). */
  enabled?: boolean;
  /**
   * Délai minimal entre deux rafraîchissements déclenchés par le retour sur
   * l'onglet. Évite qu'un va-et-vient entre deux onglets ne mitraille le
   * serveur.
   */
  focusMinIntervalMs?: number;
};

/**
 * Rafraîchissement de fond d'une liste, à la place du F5.
 *
 * Trois déclencheurs, dans l'ordre d'importance réelle :
 *
 * 1. **le retour sur l'onglet** — c'est le geste que remplace ce hook. On
 *    revient sur la page, la donnée est à jour ; il n'y a plus de raison de
 *    recharger ;
 * 2. **le retour du réseau** ;
 * 3. **une période de fond**, ajustée au palier du lecteur
 *    (`lib/shared/refresh-tiers.ts`).
 *
 * Deux garde-fous qui comptent autant que le reste : rien ne part quand
 * l'onglet est caché — cent onglets oubliés ne doivent rien coûter — et les
 * déclenchements par focus sont étranglés.
 */
export function useAutoRefresh(
  refresh: () => void | Promise<void>,
  { intervalMs, enabled = true, focusMinIntervalMs = FOCUS_REFRESH_MIN_INTERVAL_MS }: AutoRefreshOptions,
) {
  // `refresh` est relu à chaque déclenchement : une fonction recréée à chaque
  // rendu ne doit pas relancer le minuteur.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastRunAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    const run = () => {
      lastRunAtRef.current = Date.now();
      void refreshRef.current();
    };

    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      run();
    }, intervalMs);

    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRunAtRef.current < focusMinIntervalMs) return;
      run();
    };

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [enabled, intervalMs, focusMinIntervalMs]);

  /** À appeler après un chargement manuel, pour ne pas en réarmer un aussitôt. */
  return {
    markRefreshed: () => {
      lastRunAtRef.current = Date.now();
    },
  };
}
