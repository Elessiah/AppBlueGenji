"use client";

import { useClock } from "@/lib/shared/hooks/useClock";
import { isTournamentPublished } from "@/lib/shared/tournament-visibility";

/** Relecture de l'heure : un tournoi qui devient public sous les yeux du lecteur le devient à l'écran. */
const PUBLISHED_CLOCK_MS = 30_000;

/**
 * Marge prise sur l'horloge du lecteur : le serveur seul décide de la
 * publication (`/suivre/` répond « introuvable » avant). Une horloge qui avance
 * de quelques minutes ferait sinon partager un lien dont l'encart, lu par le
 * robot avant l'heure côté serveur, resterait vide dans Discord.
 */
export const SHARE_PUBLISHED_MARGIN_MS = 5 * 60_000;

/**
 * Le tournoi est-il publié **maintenant** (`SHARE_EMBEDS.md`), marge
 * d'horloge comprise ({@link SHARE_PUBLISHED_MARGIN_MS}) ? Tant qu'il ne l'est
 * pas, l'horloge (`useClock`, 30 s) relance le rendu : le bouton « Partager »
 * et l'action des matchs apparaissent sans recharger. **Une fois publié,
 * l'horloge s'arrête** : un tournoi publié ne se dépublie pas, et un battement
 * de plus ne ferait que redessiner toute la fiche pour rien. Sans carte, aucune
 * horloge.
 */
export function useTournamentPublished(card: Parameters<typeof isTournamentPublished>[0] | null): boolean {
  const published = card !== null && isTournamentPublished(card, new Date(Date.now() - SHARE_PUBLISHED_MARGIN_MS));
  useClock(PUBLISHED_CLOCK_MS, card !== null && !published);
  return published;
}
