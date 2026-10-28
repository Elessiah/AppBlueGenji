"use client";

import { createContext, useContext } from "react";

/**
 * Vrai sous la page d'un match (`MatchPage`, `docs/features/MATCH_PAGE.md`) :
 * la carte qu'elle reprend y tait ses liens vers cette même page (« Voir le
 * match », « +N » streams) — la page les détaille déjà tous.
 */
const MatchPageScopeContext = createContext(false);

export const MatchPageScope = MatchPageScopeContext.Provider;

export function useOnMatchPage(): boolean {
  return useContext(MatchPageScopeContext);
}
