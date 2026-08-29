"use client";

import { useState } from "react";
import type { LandingLive } from "@/lib/shared/landing";
import { LANDING_LIVE_INTERVAL_MS } from "@/lib/shared/refresh-tiers";
import { useAutoRefresh } from "@/lib/shared/hooks/useAutoRefresh";

type LiveResponse = {
  live: LandingLive | null;
};

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
 *
 * La cadence est celle du palier spectateur (`lib/shared/refresh-tiers.ts`), et
 * le premier chargement est **omis** : la page est rendue côté serveur avec une
 * valeur fraîche, qui arrive en `initialLive`. Un sondage court, relancé dès le
 * montage et poursuivi onglet caché, faisait à lui seul une dizaine de requêtes
 * par seconde dès qu'une centaine de visiteurs ouvraient l'accueil — sur une
 * agrégation de tous les tournois, et sur un Raspberry Pi. `useAutoRefresh` s'en
 * charge : rien tant que l'onglet est caché, relecture au retour dessus,
 * abandon de la requête en vol au démontage.
 */
export function useLandingLive(initialLive: LandingLive | null): LandingLive | null {
  const [live, setLive] = useState<LandingLive | null>(initialLive);

  useAutoRefresh(
    async (signal) => {
      try {
        const response = await fetch("/api/landing/live", { cache: "no-store", signal });
        if (!response.ok) return;
        const payload = (await response.json()) as LiveResponse;
        setLive(payload.live ?? null);
      } catch {
        // Réseau coupé, requête abandonnée ou onglet en cours de fermeture : on
        // garde l'état précédent et le prochain passage réessaiera.
      }
    },
    { intervalMs: LANDING_LIVE_INTERVAL_MS },
  );

  return live;
}
