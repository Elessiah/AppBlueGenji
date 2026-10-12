"use client";

import type { PlayersMessages } from "./players-text";
import { createScopedTextSlot } from "./scoped-text-context";

/**
 * Le fournisseur des textes des joueurs, **sans** leur français : posé par
 * `app/(secured)/joueurs/layout.tsx`, il n'embarque pas
 * `messages/fr/players.json` dans le morceau de la mise en page — chaque page
 * l'a déjà (`players-text.tsx`).
 */
export const playersTextSlot = createScopedTextSlot<PlayersMessages>();

export const PlayersTextProvider = playersTextSlot.Provider;
