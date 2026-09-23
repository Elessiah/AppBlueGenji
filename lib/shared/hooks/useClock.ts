"use client";

import { useEffect, useState } from "react";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";

/**
 * Horloge d'affichage : l'instant courant, relu toutes les `periodMs`.
 *
 * Soumise au régime de charge (`lib/shared/client-power.ts`) : elle s'arrête
 * quand l'onglet est caché — un compte à rebours que personne ne voit n'a pas à
 * réveiller la page chaque seconde — et se recale **immédiatement** au retour,
 * sans attendre le battement suivant.
 *
 * `null` avant le montage : l'heure du serveur n'est pas celle du lecteur, et
 * la rendre au premier passage ferait diverger l'hydratation.
 */
export function useClock(periodMs: number, enabled = true): number | null {
  const { clocks } = useClientPower();
  const [now, setNow] = useState<number | null>(null);
  const running = enabled && clocks;

  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(timer);
  }, [periodMs, running]);

  return now;
}
