"use client";

import type { TeamPageMessages } from "./team-page-text";
import { createScopedTextSlot } from "./scoped-text-context";

/**
 * Le fournisseur des textes de la fiche `/equipes/[id]`, **sans** leur
 * français : posé par `app/(secured)/equipes/[id]/layout.tsx`, il n'embarque
 * pas `messages/fr/team.json` dans le morceau de la mise en page — la page
 * l'a déjà (`team-page-text.tsx`).
 */
export const teamPageTextSlot = createScopedTextSlot<TeamPageMessages>();

export const TeamPageTextProvider = teamPageTextSlot.Provider;
