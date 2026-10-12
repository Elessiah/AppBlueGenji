"use client";

import frTeam from "@/messages/fr/team.json";
import type { Leaves, ScopedText } from "@/lib/shared/scoped-text";
import { createScopedTextContext } from "./scoped-text-context";

/**
 * Textes de la fiche `/equipes/[id]` et de ses fenêtres (espace `team`,
 * lot 9) : français du paquet, anglais sérialisé par
 * `app/(secured)/equipes/[id]/layout.tsx` sous `/en` seulement. Un fichier à
 * part de l'annuaire (`teams`), pour que la liste n'embarque pas le texte de
 * la fiche.
 */
export type TeamPageMessages = typeof frTeam;
export type TeamPageText = ScopedText<Leaves<TeamPageMessages>>;

const context = createScopedTextContext<TeamPageMessages>(frTeam);

export const TeamPageTextProvider = context.Provider;
export const FR_TEAM_PAGE_TEXT: TeamPageText = context.fr;

export function useTeamPageText(): TeamPageText {
  return context.useText();
}
