"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BracketMatch } from "@/lib/shared/types";

type LiveControls = {
  /** Le viewer porte-t-il la permission `live` (ADMIN, ARBITRE, CASTER) ? */
  canManage: boolean;
  /** Ouvre la configuration de diffusion d'un match. */
  openConfig: (match: BracketMatch) => void;
};

const LiveContext = createContext<LiveControls>({
  canManage: false,
  openConfig: () => undefined,
});

/**
 * Contrôles de diffusion, diffusés par contexte.
 *
 * `MatchRow` est rendu depuis six vues différentes (arbre, survie, suisse,
 * endurance, sections, phases) : faire descendre `canManage` et l'ouverture du
 * dialogue en props obligerait chacune à relayer deux valeurs qui ne la
 * concernent pas. Même choix que `MatchFormatProvider` et `EntrantProvider`.
 */
export function LiveProvider({
  canManage,
  openConfig,
  children,
}: LiveControls & { children: ReactNode }) {
  return (
    <LiveContext.Provider value={{ canManage, openConfig }}>{children}</LiveContext.Provider>
  );
}

export function useLiveControls(): LiveControls {
  return useContext(LiveContext);
}
