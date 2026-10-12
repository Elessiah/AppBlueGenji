"use client";

import type { TeamPageMessages } from "./team-page-text";
import { primeEnglish } from "./english-loaders";
import { englishTeam } from "./english-loaders-account";
import { createScopedTextSlot, type ScopedTextProvider } from "./scoped-text-context";

/**
 * Le fournisseur des textes de la fiche `/equipes/[id]`, **sans** leur
 * français : posé par `app/(secured)/equipes/[id]/layout.tsx`, il n'embarque
 * pas `messages/fr/team.json` dans le morceau de la mise en page — la page
 * l'a déjà (`team-page-text.tsx`).
 */
export const teamPageTextSlot = createScopedTextSlot<TeamPageMessages>();

/** L'anglais reçu amorce le chargeur partagé (`englishTeam`, revue de performance du lot 9-2) : une navigation suivante ne le recharge pas. */
export const TeamPageTextProvider: ScopedTextProvider<TeamPageMessages> = (props) => {
  primeEnglish(englishTeam, props.locale, props.messages);
  return <teamPageTextSlot.Provider {...props} />;
};
