"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@/lib/shared/locales";
import {
  FR_TOURNAMENT_PAGE_TEXT,
  tournamentPageText,
  type TournamentPageMessages,
  type TournamentPageText,
} from "@/lib/shared/tournament-page-text";

/**
 * Textes de la fiche d'un tournoi (`lib/shared/tournament-page-text.ts`). Hors
 * fournisseur (tests, composant rendu ailleurs) : le français du paquet.
 */
const TournamentPageTextContext = createContext<TournamentPageText>(FR_TOURNAMENT_PAGE_TEXT);

export function TournamentPageTextProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: TournamentPageMessages; children: ReactNode }>) {
  // `messages` n'est passé que sous `/en` : une fiche française ne sérialise
  // aucun dictionnaire, son texte est déjà dans le paquet.
  const value = useMemo(() => (messages ? tournamentPageText(locale, messages) : FR_TOURNAMENT_PAGE_TEXT), [locale, messages]);
  return <TournamentPageTextContext.Provider value={value}>{children}</TournamentPageTextContext.Provider>;
}

export function useTournamentPageText(): TournamentPageText {
  return useContext(TournamentPageTextContext);
}
