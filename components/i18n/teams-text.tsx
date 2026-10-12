"use client";

import frTeams from "@/messages/fr/teams.json";
import type { Leaves, ScopedText } from "@/lib/shared/scoped-text";
import { createScopedTextContext } from "./scoped-text-context";

/**
 * Textes de l'annuaire `/equipes`, de ses cartes et de la création d'une équipe
 * (espace `teams`, lot 9) : français du paquet, anglais sérialisé par
 * `app/(secured)/equipes/layout.tsx` sous `/en` seulement.
 */
export type TeamsMessages = typeof frTeams;
export type TeamsText = ScopedText<Leaves<TeamsMessages>>;

const context = createScopedTextContext<TeamsMessages>(frTeams);

export const TeamsTextProvider = context.Provider;
export const FR_TEAMS_TEXT: TeamsText = context.fr;

export function useTeamsText(): TeamsText {
  return context.useText();
}
