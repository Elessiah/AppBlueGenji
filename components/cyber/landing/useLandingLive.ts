"use client";

import { useEffect, useState } from "react";
import type { LandingLive } from "@/lib/shared/landing";

type LiveResponse = {
  live: LandingLive | null;
};

/** Cadence de rafraîchissement de la carte live de l'accueil. */
const POLL_INTERVAL_MS = 10_000;

/**
 * Suit l'état du direct sur la page d'accueil.
 *
 * Un seul appelant (le `Hero`) : la carte live **et** le bouton « Regarder le
 * live » lisent le même état, sinon deux composants interrogeraient le même
 * endpoint à des instants différents et pourraient s'afficher en désaccord —
 * une carte annonçant un match en direct au-dessus d'un bouton absent.
 *
 * Le serveur remplit déjà `game`, `phase` et `stream` ; rien n'est recalculé
 * ici, pour qu'il n'existe qu'une définition de ces libellés.
 */
export function useLandingLive(initialLive: LandingLive | null): LandingLive | null {
  const [live, setLive] = useState<LandingLive | null>(initialLive);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function loadLive() {
      try {
        const response = await fetch("/api/landing/live", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as LiveResponse;
        if (mounted) setLive(payload.live ?? null);
      } catch {
        // Réseau coupé ou onglet en cours de fermeture : on garde l'état
        // précédent et le prochain tick réessaiera.
      }
    }

    void loadLive();
    const interval = window.setInterval(() => {
      void loadLive();
    }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  return live;
}
