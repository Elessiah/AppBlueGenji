"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CastBlock } from "@/lib/shared/match-launch";
import type { BracketMatch, MatchRefereeName } from "@/lib/shared/types";
import type { MatchVoiceLink } from "@/lib/shared/match-voice";

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
  /**
   * Option du tournoi « phase de lancement » (`docs/features/MATCH_LAUNCH.md`) :
   * éteinte, un match part dès son heure — ni « Lancement » ni « Prêt ».
   */
  launchPhase: boolean;
  /** Ouvre la configuration de diffusion d'un match. */
  openConfig: (match: BracketMatch) => void;
  /** Ouvre la date de début d'un match. */
  openSchedule: (match: BracketMatch) => void;
  /** Lecteur : reconnaître « je caste ce match ». */
  viewerUserId: number | null;
  /**
   * Admin de la plateforme (`canDelete`) : change toujours le mode d'antenne
   * (`viewerMayChangeLiveTrigger`, `lib/shared/live-trigger-owner.ts`).
   */
  viewerIsAdmin: boolean;
  /** Engagé du lecteur dans ce tournoi (`null` s'il n'y joue pas). */
  myTeamId: number | null;
  /** Ce qui empêche le lecteur de caster, `null` s'il le peut. */
  castBlock: CastBlock | null;
  /**
   * Ouvre le lien de rediff d'un match terminé — même public que la diffusion
   * (`canManage`), dont la rediff est la suite.
   */
  openReplay: (match: BracketMatch) => void;
  /**
   * Pseudos des arbitres désignés (contexte du lecteur connecté, décision 52) ;
   * vide sur la page sans compte, qui lit « Arbitre désigné » (`refereeNameOf`).
   */
  refereeNames: readonly MatchRefereeName[];
  /**
   * Liens des salons vocaux de l'équipe du lecteur (contexte du lecteur,
   * `MATCH_VOICE.md`) ; vide sans équipe ou sur la page sans compte.
   */
  voiceLinks: readonly MatchVoiceLink[];
};

const NO_REFEREE_NAMES: readonly MatchRefereeName[] = [];
const NO_VOICE_LINKS: readonly MatchVoiceLink[] = [];

const LiveContext = createContext<LiveControls>({
  canManage: false,
  canSchedule: false,
  refereeScheduling: false,
  // Hors fournisseur, la règle d'origine (`MatchLaunchInput.launchPhase` absent).
  launchPhase: true,
  openConfig: () => undefined,
  openSchedule: () => undefined,
  viewerUserId: null,
  viewerIsAdmin: false,
  myTeamId: null,
  castBlock: "NOT_CASTER",
  openReplay: () => undefined,
  refereeNames: NO_REFEREE_NAMES,
  voiceLinks: NO_VOICE_LINKS,
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
  launchPhase,
  openConfig,
  openSchedule,
  viewerUserId,
  viewerIsAdmin = false,
  myTeamId,
  castBlock,
  openReplay,
  refereeNames = NO_REFEREE_NAMES,
  voiceLinks = NO_VOICE_LINKS,
  children,
}: Readonly<
  Omit<LiveControls, "refereeNames" | "viewerIsAdmin" | "voiceLinks"> & {
    refereeNames?: LiveControls["refereeNames"];
    viewerIsAdmin?: boolean;
    voiceLinks?: LiveControls["voiceLinks"];
    children: ReactNode;
  }
>) {
  const value = useMemo(
    () => ({
      canManage,
      canSchedule,
      refereeScheduling,
      launchPhase,
      openConfig,
      openSchedule,
      viewerUserId,
      viewerIsAdmin,
      myTeamId,
      castBlock,
      openReplay,
      refereeNames,
      voiceLinks,
    }),
    [
      canManage,
      canSchedule,
      refereeScheduling,
      launchPhase,
      openConfig,
      openSchedule,
      viewerUserId,
      viewerIsAdmin,
      myTeamId,
      castBlock,
      openReplay,
      refereeNames,
      voiceLinks,
    ],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveControls(): LiveControls {
  return useContext(LiveContext);
}
