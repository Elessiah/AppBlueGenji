"use client";

import frPlayers from "@/messages/fr/players.json";
import type { Leaves, ScopedText } from "@/lib/shared/scoped-text";
import { withFrenchFallback } from "./scoped-text-context";
import { playersTextSlot } from "./players-text-provider";

/**
 * Textes de l'annuaire `/joueurs` et de la fiche `/joueurs/[id]` (espace
 * `players`, lot 9) : français du paquet, anglais sérialisé par
 * `app/(secured)/joueurs/layout.tsx` sous `/en` seulement — par le
 * fournisseur de `players-text-provider.tsx`, sans ce français.
 */
export type PlayersMessages = typeof frPlayers;
export type PlayersText = ScopedText<Leaves<PlayersMessages>>;

const context = withFrenchFallback(playersTextSlot, frPlayers);

export const FR_PLAYERS_TEXT: PlayersText = context.fr;

export function usePlayersText(): PlayersText {
  return context.useText();
}
