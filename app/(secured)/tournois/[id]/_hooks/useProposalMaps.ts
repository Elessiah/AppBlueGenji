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
 * Attente avant la tentative suivante : l'espacement de base, jamais moins que
 * le `Retry-After` (secondes) d'un 429 — relancer avant reprendrait un refus.
 */
export function proposalRetryDelayMs(retryAfterHeader: string | null): number {
  const seconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
  const floorMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  return Math.max(PROPOSAL_REFRESH_DELAY_MS, floorMs);
}

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
    // Une relecture, puis au plus deux nouvelles tentatives tant que le détail
    // manque : seul le détail arrivé dit que la lecture a abouti — il fait alors
    // tomber `needsRefresh`, et le nettoyage arrête les tentatives. Chaque
    // tentative part **après** la réponse de la précédente (jamais deux lectures
    // en vol sur un serveur lent), à l'espacement de base ou au `Retry-After`
    // d'un 429 s'il est plus long.
    // Une réponse lue clôt les tentatives, même si elle décrit une proposition
    // plus récente que l'instantané (voir `read`).
    // Un `proposals: null` du serveur est une réponse, pas un échec : rien n'est
    // lisible pour ce lecteur sur l'état relu (engagé remplacé, report retiré),
    // et les tentatives restantes reposeraient la même question pour rien. De
    // même d'un refus définitif (4xx hors 429 : session expirée, tournoi masqué) ;
    // seuls un 429, un 5xx ou le réseau se retentent.
    const controller = new AbortController();
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** L'attente avant de retenter, ou `null` : la réponse clôt les tentatives. */
    const read = async (): Promise<number | null> => {
      try {
        const response = await fetch(`/api/tournaments/${tournamentId}/matches/${matchId}/proposals`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 429) return proposalRetryDelayMs(response.headers.get("Retry-After"));
          return response.status >= 400 && response.status < 500 ? null : PROPOSAL_REFRESH_DELAY_MS;
        }
        const payload = (await response.json()) as { proposals?: unknown };
        if (payload.proposals === null) return null;
        const parsed = parseMatchProposals(payload.proposals, matchId);
        if (parsed) {
          // Réponse lue : elle décrit la proposition affichée (le détail
          // arrive), ou une plus récente que l'instantané — dont la diffusion
          // change `reportsKey` et relance la lecture. Relire tout de suite
          // rendrait la même réponse.
          if (!controller.signal.aborted) setFetched(parsed);
          return null;
        }
      } catch {
        // Réseau coupé ou dialogue fermé : la tentative suivante relira.
      }
      return PROPOSAL_REFRESH_DELAY_MS;
    };
    const attempt = async () => {
      tries += 1;
      const waitMs = await read();
      if (waitMs === null || controller.signal.aborted || tries >= PROPOSAL_REFRESH_ATTEMPTS) return;
      timer = setTimeout(() => void attempt(), waitMs);
    };
    void attempt();
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [needsRefresh, reportsKey, tournamentId, matchId]);
  return { match, proposals: readable };
}
