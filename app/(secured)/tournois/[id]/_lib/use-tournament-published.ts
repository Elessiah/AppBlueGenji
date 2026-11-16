"use client";

import { useClock } from "@/lib/shared/hooks/useClock";
import { isTournamentPublished } from "@/lib/shared/tournament-visibility";

/** Relecture de l'heure : un tournoi qui devient public sous les yeux du lecteur le devient à l'écran. */
const PUBLISHED_CLOCK_MS = 30_000;

/**
 * Le tournoi est-il publié **maintenant** (`SHARE_EMBEDS.md`) ? Tant qu'il ne
 * l'est pas, l'horloge (`useClock`, 30 s) relance le rendu : le bouton
 * « Partager » et l'action des matchs apparaissent à l'instant de la
 * publication, sans recharger. **Une fois publié, l'horloge s'arrête** : un
 * tournoi publié ne se dépublie pas, et un battement de plus ne ferait que
 * redessiner toute la fiche pour rien. Sans carte, aucune horloge.
 */
export function useTournamentPublished(card: Parameters<typeof isTournamentPublished>[0] | null): boolean {
  const published = card !== null && isTournamentPublished(card);
  useClock(PUBLISHED_CLOCK_MS, card !== null && !published);
  return published;
}
