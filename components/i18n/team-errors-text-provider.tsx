"use client";

import type { TeamErrorsMessages } from "@/app/(secured)/equipes/_lib/team-errors";
import { englishTeamErrors, primeEnglish } from "./english-loaders";
import { createScopedTextSlot, type ScopedTextProvider } from "./scoped-text-context";

/**
 * Le fournisseur de la table des refus d'équipe, **sans** son français : posé
 * par `app/(secured)/equipes/layout.tsx`, il n'embarque ni
 * `messages/fr/teamErrors.json` ni le registre dans le morceau de la mise en
 * page — les pages les ont déjà (`team-errors-text.tsx`).
 */
export const teamErrorsTextSlot = createScopedTextSlot<TeamErrorsMessages>();

/**
 * L'anglais reçu (mises en page des équipes, du profil) amorce le chargeur
 * partagé (`englishTeamErrors`, revue de performance du lot 9-2) : `/profil`
 * atteint ensuite par navigation ne le télécharge pas une seconde fois.
 */
export const TeamErrorsTextProvider: ScopedTextProvider<TeamErrorsMessages> = (props) => {
  primeEnglish(englishTeamErrors, props.locale, props.messages);
  return <teamErrorsTextSlot.Provider {...props} />;
};
