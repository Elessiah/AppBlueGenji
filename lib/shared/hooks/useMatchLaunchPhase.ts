"use client";

import { useEffect, useState } from "react";
import {
  matchLaunchPhase,
  nextLaunchPhaseChangeAt,
  type MatchLaunchInput,
  type MatchLaunchPhase,
} from "@/lib/shared/match-launch";

/**
 * Phase de lancement d'un match, **rebasculée à la seconde dite** : le passage
 * de « programmé » à « en lancement » ne tient qu'à l'horloge, que le flux ne
 * peut pas annoncer. Un unique `setTimeout` sur l'heure de début, comme
 * `useMatchLiveState` — et aucun pour un match sans frontière à venir.
 */
export function useMatchLaunchPhase(match: MatchLaunchInput): MatchLaunchPhase {
  const [now, setNow] = useState(() => Date.now());
  // Dépendances réduites à des primitives (voir `useMatchLiveState`).
  const { status, team1Id, team2Id, startAt, launchedAt } = match;

  useEffect(() => {
    setNow(Date.now());
  }, [status, team1Id, team2Id, startAt, launchedAt]);

  useEffect(() => {
    const at = nextLaunchPhaseChangeAt({ status, team1Id, team2Id, startAt, launchedAt }, now);
    if (at === null) return;
    const delay = Math.min(Math.max(0, at - Date.now()), 2_147_483_647);
    // `Math.max(at, …)` : franchir la frontière même sur un réveil précoce.
    const timer = setTimeout(() => setNow(Math.max(at, Date.now())), delay);
    return () => clearTimeout(timer);
  }, [status, team1Id, team2Id, startAt, launchedAt, now]);

  return matchLaunchPhase({ status, team1Id, team2Id, startAt, launchedAt }, now);
}
