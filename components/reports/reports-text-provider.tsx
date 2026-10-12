"use client";

import type frReports from "@/messages/fr/reports.json";
import { createScopedTextSlot, type ScopedTextProvider } from "@/components/i18n/scoped-text-context";
import { primeEnglishReports } from "./report-form-loader";

/**
 * Le fournisseur des textes `reports`, **sans** leur français (revue de
 * performance du lot 9-2) : posé par le formulaire lui-même autour de son
 * anglais chargé au clic (`ReportProblemDialog`, `englishMessages`), et par la
 * mise en page de `/signalements/[id]`. Aucun des deux n'embarque
 * `messages/fr/reports.json` — il voyage avec le formulaire et la page
 * (`reports-text.ts`) — ni l'anglais, chargé au clic sous `/en` ou sérialisé
 * sous `/en` seulement (mise en page).
 *
 * L'anglais reçu ici est aussi remis au chargeur du pied de page
 * (`primeEnglishReports`) : ouvert sur cette page, le formulaire ne le
 * télécharge pas une seconde fois.
 */
export const reportsTextSlot = createScopedTextSlot<typeof frReports>();

export const ReportsTextProvider: ScopedTextProvider<typeof frReports> = (props) => {
  if (props.locale === "en" && props.messages) primeEnglishReports(props.messages);
  return <reportsTextSlot.Provider {...props} />;
};
