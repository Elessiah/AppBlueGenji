"use client";

import type { PlayersMessages } from "./players-text";
import { primeEnglish } from "./english-loaders";
import { englishPlayers } from "./english-loaders-account";
import { createScopedTextSlot, type ScopedTextProvider } from "./scoped-text-context";

/**
 * Le fournisseur des textes des joueurs, **sans** leur français : posé par
 * `app/(secured)/joueurs/layout.tsx`, il n'embarque pas
 * `messages/fr/players.json` dans le morceau de la mise en page — chaque page
 * l'a déjà (`players-text.tsx`).
 */
export const playersTextSlot = createScopedTextSlot<PlayersMessages>();

/** L'anglais reçu amorce le chargeur partagé (`englishPlayers`, revue de performance du lot 9-2) : une navigation suivante ne le recharge pas. */
export const PlayersTextProvider: ScopedTextProvider<PlayersMessages> = (props) => {
  primeEnglish(englishPlayers, props.locale, props.messages);
  return <playersTextSlot.Provider {...props} />;
};
