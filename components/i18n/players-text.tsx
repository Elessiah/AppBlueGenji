"use client";

import frPlayers from "@/messages/fr/players.json";
import type { Leaves, ScopedText } from "@/lib/shared/scoped-text";
import { createScopedTextContext } from "./scoped-text-context";

/**
 * Textes de l'annuaire `/joueurs` et de la fiche `/joueurs/[id]` (espace
 * `players`, lot 9) : français du paquet, anglais sérialisé par
 * `app/(secured)/joueurs/layout.tsx` sous `/en` seulement.
 */
export type PlayersMessages = typeof frPlayers;
export type PlayersText = ScopedText<Leaves<PlayersMessages>>;

const context = createScopedTextContext<PlayersMessages>(frPlayers);

export const PlayersTextProvider = context.Provider;
export const FR_PLAYERS_TEXT: PlayersText = context.fr;

export function usePlayersText(): PlayersText {
  return context.useText();
}
