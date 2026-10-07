"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@/lib/shared/locales";
import {
  FR_TOURNAMENTS_TEXT,
  tournamentsText,
  type TournamentsClientMessages,
  type TournamentsText,
} from "@/lib/shared/tournaments-text";

/**
 * Textes des écrans client des tournois (`lib/shared/tournaments-text.ts`).
 * Hors fournisseur (tests, bouton d'aide rendu ailleurs) : le français du
 * paquet.
 */
const TournamentsTextContext = createContext<TournamentsText>(FR_TOURNAMENTS_TEXT);

export function TournamentsTextProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: TournamentsClientMessages; children: ReactNode }>) {
  // `messages` n'est passé que sous `/en` : une page française ne sérialise
  // aucun dictionnaire, son texte est déjà dans le paquet.
  const value = useMemo(() => (messages ? tournamentsText(locale, messages) : FR_TOURNAMENTS_TEXT), [locale, messages]);
  return <TournamentsTextContext.Provider value={value}>{children}</TournamentsTextContext.Provider>;
}

export function useTournamentsText(): TournamentsText {
  return useContext(TournamentsTextContext);
}
