"use client";

import { useEffect, useMemo, useRef } from "react";
import { proposalsNeedRefresh, withProposalMaps } from "@/lib/shared/player-score-report";
import type { BracketMatch, MatchProposalMaps } from "@/lib/shared/types";

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
  const refreshAsked = useRef<string | null>(null);
  const inFlight = useRef(false);
  const reportsKey = `${liveMatch.team1Report?.reportedAt ?? ""}|${liveMatch.team2Report?.reportedAt ?? ""}`;
  useEffect(() => {
    if (!needsRefresh || inFlight.current || refreshAsked.current === reportsKey) return;
    inFlight.current = true;
    // Notée faite **une fois aboutie** : une relecture échouée (coupure réseau)
    // se retente au rendu suivant, sans quoi « Confirmer » resterait hors d'atteinte.
    Promise.resolve(onRefresh())
      .then(() => {
        refreshAsked.current = reportsKey;
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
      });
  }, [needsRefresh, reportsKey, onRefresh]);
  return match;
}
