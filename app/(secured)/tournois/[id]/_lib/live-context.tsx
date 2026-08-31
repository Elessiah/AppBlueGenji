"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { BracketMatch } from "@/lib/shared/types";

type LiveControls = {
  /** Le viewer porte-t-il la permission `live` (ADMIN, ARBITRE, CASTER) ? */
  canManage: boolean;
  /**
   * Le viewer porte-t-il la permission `tournaments` (ADMIN, ARBITRE) ? Ouvre
   * la programmation des matchs — distincte de la diffusion : un caster pose la
   * chaîne d'un match, il ne décide pas de son horaire.
   */
  canSchedule: boolean;
  /** Ouvre la configuration de diffusion d'un match. */
  openConfig: (match: BracketMatch) => void;
  /** Ouvre la date de début d'un match. */
  openSchedule: (match: BracketMatch) => void;
};

const LiveContext = createContext<LiveControls>({
  canManage: false,
  canSchedule: false,
  openConfig: () => undefined,
  openSchedule: () => undefined,
});

/**
 * Contrôles de diffusion, diffusés par contexte.
 *
 * `MatchRow` est rendu depuis six vues différentes (arbre, survie, suisse,
 * endurance, sections, phases) : faire descendre les droits et l'ouverture des
 * dialogues en props obligerait chacune à relayer quatre valeurs qui ne la
 * concernent pas. Même choix que `MatchFormatProvider` et `EntrantProvider`.
 */
export function LiveProvider({
  canManage,
  canSchedule,
  openConfig,
  openSchedule,
  children,
}: LiveControls & { children: ReactNode }) {
  const value = useMemo(
    () => ({ canManage, canSchedule, openConfig, openSchedule }),
    [canManage, canSchedule, openConfig, openSchedule],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveControls(): LiveControls {
  return useContext(LiveContext);
}
