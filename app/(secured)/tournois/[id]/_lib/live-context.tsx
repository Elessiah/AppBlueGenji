"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CastBlock } from "@/lib/shared/match-launch";
import { refereeNameOf, viewerRefereesMatch } from "@/lib/shared/match-referee";
import type { BracketMatch, MatchRefereeName } from "@/lib/shared/types";

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

const NO_REFEREE_NAMES: readonly MatchRefereeName[] = [];

/** `useLayoutEffect` au navigateur, sans l'avertissement du rendu serveur. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Pseudos des arbitres désignés (contexte du lecteur connecté, décision 52) ;
 * vides sur la page sans compte, qui lit « Arbitre désigné » (`refereeNameOf`).
 *
 * Tenus **hors** du contexte des contrôles, dans un petit magasin : une
 * relecture qui les change ne redessine que les cartes et fenêtres dont la
 * réponse change (`useSyncExternalStore` sur une valeur simple par match), pas
 * tout le plateau abonné aux contrôles.
 */
type RefereeNamesStore = {
  get: () => readonly MatchRefereeName[];
  set: (names: readonly MatchRefereeName[]) => void;
  subscribe: (listener: () => void) => () => void;
};

function createRefereeNamesStore(initial: readonly MatchRefereeName[]): RefereeNamesStore {
  let names = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => names,
    set: (next) => {
      if (next === names) return;
      names = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const RefereeNamesContext = createContext<RefereeNamesStore>(createRefereeNamesStore(NO_REFEREE_NAMES));

/** Une valeur simple tirée des pseudos : la carte ne se redessine que si elle change. */
function useRefereeNamesValue<T>(select: (names: readonly MatchRefereeName[]) => T): T {
  const store = useContext(RefereeNamesContext);
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

/** Pseudo de l'arbitre à montrer sur ce match (`refereeNameOf`), `null` pour « Arbitre désigné ». */
export function useRefereeNameOf(match: Pick<BracketMatch, "id" | "refereeKey" | "status">): string | null {
  return useRefereeNamesValue((names) => refereeNameOf(match, names));
}

/** Le lecteur est-il l'arbitre désigné montré de ce match (`viewerRefereesMatch`) ? */
export function useViewerRefereesMatch(match: Pick<BracketMatch, "id" | "refereeKey" | "status">): boolean {
  return useRefereeNamesValue((names) => viewerRefereesMatch(match, names));
}

const LiveContext = createContext<LiveControls>({
  canManage: false,
  canSchedule: false,
  refereeScheduling: false,
  // Hors fournisseur, la règle d'origine (`MatchLaunchInput.launchPhase` absent).
  launchPhase: true,
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
  launchPhase,
  openConfig,
  openSchedule,
  viewerUserId,
  myTeamId,
  castBlock,
  openReplay,
  refereeNames = NO_REFEREE_NAMES,
  children,
}: Readonly<
  LiveControls & {
    refereeNames?: readonly MatchRefereeName[];
    children: ReactNode;
  }
>) {
  const [store] = useState(() => createRefereeNamesStore(refereeNames));
  // Après le rendu : seuls les abonnés dont la valeur change se redessinent.
  useIsomorphicLayoutEffect(() => store.set(refereeNames), [store, refereeNames]);
  const value = useMemo(
    () => ({
      canManage,
      canSchedule,
      refereeScheduling,
      launchPhase,
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
      launchPhase,
      openConfig,
      openSchedule,
      viewerUserId,
      myTeamId,
      castBlock,
      openReplay,
    ],
  );
  return (
    <LiveContext.Provider value={value}>
      <RefereeNamesContext.Provider value={store}>{children}</RefereeNamesContext.Provider>
    </LiveContext.Provider>
  );
}

export function useLiveControls(): LiveControls {
  return useContext(LiveContext);
}
