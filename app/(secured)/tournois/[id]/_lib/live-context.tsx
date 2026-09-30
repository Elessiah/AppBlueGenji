"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CastBlock } from "@/lib/shared/match-launch";
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
  /**
   * Option du tournoi « matchs planifiés par l'arbitrage »
   * (`lib/shared/match-planning.ts`) : la phase de lancement d'un match en
   * dépend (`TO_PLAN`), et chaque carte la lit ici plutôt qu'en prop.
   */
  refereeScheduling: boolean;
  /** Ouvre la configuration de diffusion d'un match. */
  openConfig: (match: BracketMatch) => void;
  /** Ouvre la date de début d'un match. */
  openSchedule: (match: BracketMatch) => void;
  /** Lecteur : reconnaître « je caste ce match ». */
  viewerUserId: number | null;
  /** Engagé du lecteur dans ce tournoi (`null` s'il n'y joue pas). */
  myTeamId: number | null;
  /** Ce qui empêche le lecteur de caster, `null` s'il le peut. */
  castBlock: CastBlock | null;
  /**
   * Ouvre le lien de rediff d'un match terminé — même public que la diffusion
   * (`canManage`), dont la rediff est la suite.
   */
  openReplay: (match: BracketMatch) => void;
};

const LiveContext = createContext<LiveControls>({
  canManage: false,
  canSchedule: false,
  refereeScheduling: false,
  openConfig: () => undefined,
  openSchedule: () => undefined,
  viewerUserId: null,
  myTeamId: null,
  castBlock: "NOT_CASTER",
  openReplay: () => undefined,
});

/**
 * Contrôles de diffusion, diffusés par contexte — `myTeamId` mis à part, seul
 * fait générique du lecteur ici (pas de portée diffusion), et déjà relu à ce
 * titre par `MatchLaunchStrip` comme par `MatchRow`.
 *
 * `MatchRow` est rendu depuis six vues différentes (arbre, survie, suisse,
 * endurance, sections, phases) : faire descendre les droits et l'ouverture des
 * dialogues en props obligerait chacune à relayer quatre valeurs qui ne la
 * concernent pas. Même choix que `MatchFormatProvider` et `EntrantProvider`.
 */
export function LiveProvider({
  canManage,
  canSchedule,
  refereeScheduling,
  openConfig,
  openSchedule,
  viewerUserId,
  myTeamId,
  castBlock,
  openReplay,
  children,
}: LiveControls & { children: ReactNode }) {
  const value = useMemo(
    () => ({
      canManage,
      canSchedule,
      refereeScheduling,
      openConfig,
      openSchedule,
      viewerUserId,
      myTeamId,
      castBlock,
      openReplay,
    }),
    [
      canManage,
      canSchedule,
      refereeScheduling,
      openConfig,
      openSchedule,
      viewerUserId,
      myTeamId,
      castBlock,
      openReplay,
    ],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveControls(): LiveControls {
  return useContext(LiveContext);
}
