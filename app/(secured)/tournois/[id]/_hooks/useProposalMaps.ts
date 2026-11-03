"use client";

import { useEffect, useMemo, useState } from "react";
import {
  mergeMatchProposals,
  parseMatchProposals,
  proposalsNeedRefresh,
  withProposalMaps,
} from "@/lib/shared/player-score-report";
import type { BracketMatch, MatchProposalMaps } from "@/lib/shared/types";

/** Relectures au plus pour une même proposition, et leur espacement. */
export const PROPOSAL_REFRESH_ATTEMPTS = 3;
export const PROPOSAL_REFRESH_DELAY_MS = 4000;

/**
 * Le match, propositions complétées de leur détail map par map
 * (`docs/features/MAP_SCORES.md`) — détail lu dans le contexte du lecteur, que
 * l'instantané diffusé ne porte pas —, et les propositions ainsi complétées
 * (`proposals`, celles que lit `proposalsNeedRefresh`).
 *
 * Ce contexte n'arrive qu'à la connexion au flux (ou par la lecture REST) :
 * une proposition déposée depuis se repère à son instant de dépôt, porté par
 * l'instantané, et se relit par la route légère du **seul** match
 * (`/matches/[matchId]/proposals`) — jamais le tournoi entier.
 */
export function useProposalMaps(
  liveMatch: BracketMatch,
  proposals: ReadonlyArray<MatchProposalMaps>,
  /**
   * Le lecteur a-t-il le droit de lire ces propositions (il mène le match, ou
   * l'arbitrage) ? Sinon le serveur ne les lui enverra jamais : relire serait
   * une requête pour rien, à chaque nouvelle proposition.
   */
  canRead = true,
): { match: BracketMatch; proposals: ReadonlyArray<MatchProposalMaps> } {
  const [fetched, setFetched] = useState<MatchProposalMaps | null>(null);
  const readable = useMemo(
    () => mergeMatchProposals(liveMatch, proposals, fetched),
    [liveMatch, proposals, fetched],
  );
  const match = useMemo(() => withProposalMaps(liveMatch, readable), [liveMatch, readable]);
  const needsRefresh = canRead && proposalsNeedRefresh(liveMatch, readable);
  const reportsKey = `${liveMatch.team1Report?.reportedAt ?? ""}|${liveMatch.team2Report?.reportedAt ?? ""}`;
  const { tournamentId, id: matchId } = liveMatch;
  useEffect(() => {
    if (!needsRefresh) return;
    // Une relecture, puis au plus deux nouvelles tentatives espacées tant que le
    // détail manque : seul le détail arrivé dit que la lecture a abouti — il
    // fait alors tomber `needsRefresh`, et le nettoyage arrête les tentatives.
    // Un `proposals: null` du serveur est une réponse, pas un échec : rien n'est
    // lisible pour ce lecteur sur l'état relu (engagé remplacé, report retiré),
    // et les tentatives restantes reposeraient la même question pour rien.
    const controller = new AbortController();
    let tries = 0;
    let answered = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      try {
        const response = await fetch(`/api/tournaments/${tournamentId}/matches/${matchId}/proposals`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { proposals?: unknown };
        if (payload.proposals === null) {
          answered = true;
          if (timer !== null) clearTimeout(timer);
          return;
        }
        const parsed = parseMatchProposals(payload.proposals, matchId);
        if (parsed && !controller.signal.aborted) setFetched(parsed);
      } catch {
        // Réseau coupé ou dialogue fermé : la tentative suivante relira.
      }
    };
    const attempt = () => {
      if (answered) return;
      tries += 1;
      void read();
      if (tries < PROPOSAL_REFRESH_ATTEMPTS) timer = setTimeout(attempt, PROPOSAL_REFRESH_DELAY_MS);
    };
    attempt();
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [needsRefresh, reportsKey, tournamentId, matchId]);
  return { match, proposals: readable };
}
