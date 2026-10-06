"use client";

import { useEffect, useMemo } from "react";
import { proposalsNeedRefresh, withProposalMaps } from "@/lib/shared/player-score-report";
import type { BracketMatch, MatchProposalMaps } from "@/lib/shared/types";

/** Relectures au plus pour une même proposition, et leur espacement. */
const PROPOSAL_REFRESH_ATTEMPTS = 3;
const PROPOSAL_REFRESH_DELAY_MS = 4000;

/**
 * Le match, propositions complétées de leur détail map par map
 * (`docs/features/MAP_SCORES.md`) — détail lu dans le contexte du lecteur, que
 * l'instantané diffusé ne porte pas.
 *
 * Ce contexte n'arrive qu'à la connexion au flux (ou par la lecture REST) :
 * une proposition déposée depuis se repère à son instant de dépôt, porté par
 * l'instantané, et déclenche **une** relecture par proposition (`onRefresh`).
 */
export function useProposalMaps(
  liveMatch: BracketMatch,
  proposals: ReadonlyArray<MatchProposalMaps>,
  onRefresh: () => void | Promise<unknown>,
  /**
   * Le lecteur a-t-il le droit de lire ces propositions (il mène le match, ou
   * l'arbitrage) ? Sinon le serveur ne les lui enverra jamais : relire serait
   * une requête pour rien, à chaque nouvelle proposition.
   */
  canRead = true,
): BracketMatch {
  const match = useMemo(() => withProposalMaps(liveMatch, proposals), [liveMatch, proposals]);
  const needsRefresh = canRead && proposalsNeedRefresh(liveMatch, proposals);
  const reportsKey = `${liveMatch.team1Report?.reportedAt ?? ""}|${liveMatch.team2Report?.reportedAt ?? ""}`;
  useEffect(() => {
    if (!needsRefresh) return;
    // Une relecture, puis au plus deux nouvelles tentatives espacées tant que le
    // détail manque : la lecture REST avale ses échecs (coupure réseau), seul
    // le détail arrivé dit qu'elle a abouti — il fait alors tomber
    // `needsRefresh`, et le nettoyage arrête les tentatives.
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      tries += 1;
      void Promise.resolve(onRefresh()).catch(() => undefined);
      if (tries < PROPOSAL_REFRESH_ATTEMPTS) timer = setTimeout(attempt, PROPOSAL_REFRESH_DELAY_MS);
    };
    attempt();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [needsRefresh, reportsKey, onRefresh]);
  return match;
}
