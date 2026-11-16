"use client";

import { useClock } from "@/lib/shared/hooks/useClock";
import { isTournamentPublished } from "@/lib/shared/tournament-visibility";

/** Relecture de l'heure : un tournoi qui devient public sous les yeux du lecteur le devient à l'écran. */
const PUBLISHED_CLOCK_MS = 30_000;

/**
 * Le tournoi est-il publié **maintenant** (`SHARE_EMBEDS.md`) ? Relu toutes les
 * 30 s (`useClock`) : le bouton « Partager » et l'action des matchs apparaissent
 * à l'instant de la publication, sans recharger — et tous deux lisent la même
 * horloge. Avant le montage, l'heure du rendu serveur (pas de divergence
 * d'hydratation).
 */
export function useTournamentPublished(card: Parameters<typeof isTournamentPublished>[0] | null): boolean {
  const now = useClock(PUBLISHED_CLOCK_MS);
  if (card === null) return false;
  return isTournamentPublished(card, now === null ? undefined : new Date(now));
}
