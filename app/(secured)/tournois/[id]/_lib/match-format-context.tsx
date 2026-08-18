"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MatchFormat } from "@/lib/shared/match-format";

/**
 * Format de match du tournoi (BO5, FT3…), mis à disposition des composants de
 * saisie de score.
 *
 * Il passe par un contexte plutôt que par des props : les cartes de match sont
 * rendues au fond de quatre arborescences différentes (arbre d'élimination,
 * survie, ronde suisse, endurance) qui n'ont, elles, rien à faire du format.
 * `null` = saisie libre.
 */
const MatchFormatContext = createContext<MatchFormat | null>(null);

export function MatchFormatProvider({
  format,
  children,
}: {
  format: MatchFormat | null;
  children: ReactNode;
}) {
  return <MatchFormatContext.Provider value={format}>{children}</MatchFormatContext.Provider>;
}

export function useMatchFormat(): MatchFormat | null {
  return useContext(MatchFormatContext);
}
