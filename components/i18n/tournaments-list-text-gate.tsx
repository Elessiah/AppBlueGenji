"use client";

import type { ReactNode } from "react";
import type { Locale } from "@/lib/shared/locales";
import type { TournamentsClientMessages } from "@/lib/shared/tournaments-text";
import { englishTournamentsList } from "./english-loaders-tournament";
import { TournamentsTextProvider } from "./tournaments-text";
import { useEnglishMessages } from "./use-english-messages";
import { EnglishGateFallback } from "./english-gate-fallback";

/**
 * Les textes de la liste `/tournois`, posés par sa **page** (même règle que
 * l'annuaire des équipes, revue de performance du lot 9-2) : l'anglais n'est
 * sérialisé qu'au chargement complet — jamais à une navigation, un
 * préchargement ni un `router.refresh()`, où il arrive par son morceau
 * (`englishTournamentsList`), l'écran d'attente affiché d'ici là ; un échec
 * retombe sur le français.
 */
export function TournamentsListTextGate({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: TournamentsClientMessages; children: ReactNode }>) {
  const { english, waiting } = useEnglishMessages(locale, englishTournamentsList, messages);
  if (waiting) return <EnglishGateFallback />;
  return (
    <TournamentsTextProvider locale={locale} messages={english ?? undefined}>
      {children}
    </TournamentsTextProvider>
  );
}
