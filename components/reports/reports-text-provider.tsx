"use client";

import type frReports from "@/messages/fr/reports.json";
import { englishReports, primeEnglish } from "@/components/i18n/english-loaders";
import { createScopedTextSlot, type ScopedTextProvider } from "@/components/i18n/scoped-text-context";

/**
 * Le fournisseur des textes `reports`, **sans** leur français (revue de
 * performance du lot 9-2) : posé par le formulaire lui-même autour de son
 * anglais chargé au clic (`ReportProblemDialog`, `englishMessages`), et par la
 * page d'un signalement (`ConcernedReportsText`). Aucun n'embarque
 * `messages/fr/reports.json` — il voyage avec le formulaire et la page
 * (`reports-text.ts`) — ni l'anglais.
 *
 * L'anglais reçu ici amorce le chargeur partagé (`englishReports`) : le
 * formulaire du pied de page ne le télécharge pas une seconde fois.
 */
export const reportsTextSlot = createScopedTextSlot<typeof frReports>();

export const ReportsTextProvider: ScopedTextProvider<typeof frReports> = (props) => {
  primeEnglish(englishReports, props.locale, props.messages);
  return <reportsTextSlot.Provider {...props} />;
};
