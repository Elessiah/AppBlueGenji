"use client";

import type { ReactNode } from "react";
import type { Locale } from "@/lib/shared/locales";
import { EnglishGateFallback } from "./english-gate-fallback";
import { primeEnglish } from "./english-loaders";
import { englishTournamentSheet, type TournamentSheetEnglish } from "./english-loaders-tournament";
import { TournamentActionsTextProvider } from "./tournament-actions-text";
import { TournamentPageTextProvider } from "./tournament-page-text";
import { TournamentsTextProvider } from "./tournaments-text";
import { useEnglishMessages } from "./use-english-messages";

export type { TournamentSheetEnglish };

/**
 * Les fournisseurs de la fiche (espace connecté et page sans compte) : en
 * français, rien à attendre ; sous `/en`, l'anglais reçu de la mise en page
 * (chargement complet d'une page), sinon celui de la session, sinon son
 * morceau — l'écran d'attente le temps de l'essai, un échec retombant sur le
 * français (`useEnglishMessages`).
 */
export function TournamentSheetTextGate({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: TournamentSheetEnglish; children: ReactNode }>) {
  primeEnglish(englishTournamentSheet, locale, messages);
  const { english, waiting } = useEnglishMessages(locale, englishTournamentSheet, messages);
  if (waiting) return <EnglishGateFallback />;
  // Un échec rend la fiche en français : la langue suit alors le texte.
  const shown: Locale = english ? locale : "fr";
  return (
    <TournamentsTextProvider locale={shown} messages={english?.shared}>
      <TournamentPageTextProvider locale={shown} messages={english?.page}>
        <TournamentActionsTextProvider locale={shown} messages={english?.actions}>
          {children}
        </TournamentActionsTextProvider>
      </TournamentPageTextProvider>
    </TournamentsTextProvider>
  );
}
