"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Match désigné par une ancre `#match-[id]`, diffusé par contexte.
 *
 * Même motif que `LiveProvider` et `IssueReportProvider` : les cartes de match
 * sont rendues depuis quatre vues (arbre, survie, suisse, endurance), et faire
 * descendre en props un identifiant qui ne concerne qu'une carte sur cent
 * obligerait chacune à relayer une valeur dont elle n'a que faire.
 *
 * **Deux valeurs, deux contextes**, parce qu'elles n'ont ni le même public ni le
 * même moment :
 *
 * - la **cible** (`useMatchAnchorTarget`) vaut *avant* d'avoir trouvé le match,
 *   et n'intéresse que `BracketSections`, qui doit déplier le volet où il dort ;
 * - le **surlignage** (`useHighlightedMatch`) vaut *après*, et n'intéresse que
 *   `MatchRow`.
 *
 * Les réunir en un objet ferait redessiner les 127 cartes d'un gros plateau à
 * chaque changement de l'une ou l'autre. Séparées, ce sont deux valeurs
 * primitives : elles ne changent d'identité qu'en changeant de valeur.
 */
const MatchAnchorTargetContext = createContext<number | null>(null);
const HighlightedMatchContext = createContext<number | null>(null);

export function MatchAnchorProvider({
  targetMatchId,
  highlightedMatchId,
  children,
}: {
  targetMatchId: number | null;
  highlightedMatchId: number | null;
  children: ReactNode;
}) {
  return (
    <MatchAnchorTargetContext.Provider value={targetMatchId}>
      <HighlightedMatchContext.Provider value={highlightedMatchId}>
        {children}
      </HighlightedMatchContext.Provider>
    </MatchAnchorTargetContext.Provider>
  );
}

/** Identifiant du match encore recherché par l'ancre, ou `null`. */
export function useMatchAnchorTarget(): number | null {
  return useContext(MatchAnchorTargetContext);
}

/** Identifiant du match à surligner, ou `null`. */
export function useHighlightedMatch(): number | null {
  return useContext(HighlightedMatchContext);
}
