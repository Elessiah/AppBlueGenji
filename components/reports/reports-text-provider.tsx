"use client";

import type frReports from "@/messages/fr/reports.json";
import { createScopedTextSlot } from "@/components/i18n/scoped-text-context";

/**
 * Le fournisseur des textes `reports`, **sans** leur français (revue de
 * performance du lot 9-2) : posé par `ReportProblemButton` (pied de chaque
 * page) autour du formulaire chargé au clic, et par la mise en page de
 * `/signalements/[id]`. Aucun des deux n'embarque `messages/fr/reports.json`
 * — il voyage avec le formulaire et la page (`reports-text.ts`) — ni l'anglais,
 * chargé au clic sous `/en` (bouton) ou sérialisé sous `/en` seulement (mise en
 * page).
 */
export const reportsTextSlot = createScopedTextSlot<typeof frReports>();

export const ReportsTextProvider = reportsTextSlot.Provider;
