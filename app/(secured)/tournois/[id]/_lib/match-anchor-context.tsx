"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Match arrivé par une ancre `#match-[id]`, diffusé par contexte.
 *
 * Même motif que `LiveProvider` et `IssueReportProvider` : `MatchRow` est rendu
 * depuis quatre vues (arbre, survie, suisse, endurance), et faire descendre un
 * identifiant qui ne concerne qu'une carte sur cent obligerait chacune à
 * relayer une prop dont elle n'a que faire.
 *
 * La valeur est un **nombre nu** plutôt qu'un objet : un `useMemo` de plus
 * n'apporterait rien, et une valeur primitive ne change d'identité que quand
 * elle change de valeur — les 127 cartes d'un plateau à 128 équipes ne se
 * redessinent donc qu'à l'arrivée et à l'extinction du surlignage.
 */
const HighlightedMatchContext = createContext<number | null>(null);

export function MatchHighlightProvider({
  matchId,
  children,
}: {
  matchId: number | null;
  children: ReactNode;
}) {
  return (
    <HighlightedMatchContext.Provider value={matchId}>
      {children}
    </HighlightedMatchContext.Provider>
  );
}

/** Identifiant du match à surligner, ou `null`. */
export function useHighlightedMatch(): number | null {
  return useContext(HighlightedMatchContext);
}
