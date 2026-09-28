"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { BracketMatch } from "@/lib/shared/types";

type PlayerScoreControls = {
  /** Le bouton « Saisir le score » de la carte s'affiche-t-il pour ce match ? */
  canOpen: (match: BracketMatch) => boolean;
  /** Le match est lancé : la modale offre la saisie, pas seulement le forfait. */
  canReportScore: (match: BracketMatch) => boolean;
  open: (match: BracketMatch) => void;
};

const PlayerScoreContext = createContext<PlayerScoreControls>({
  canOpen: () => false,
  canReportScore: () => false,
  open: () => undefined,
});

/**
 * Saisie du score par un engagé, diffusée par contexte — même motif que
 * `IssueReportProvider`. Le formulaire en ligne d'avant descendait en quatre
 * props (brouillons, saisie, envoi, droit) à travers les six vues du plateau,
 * qui n'en faisaient rien d'autre que les relayer à `MatchRow`.
 */
export function PlayerScoreProvider({
  canOpen,
  canReportScore,
  open,
  children,
}: PlayerScoreControls & { children: ReactNode }) {
  const value = useMemo(
    () => ({ canOpen, canReportScore, open }),
    [canOpen, canReportScore, open],
  );
  return <PlayerScoreContext.Provider value={value}>{children}</PlayerScoreContext.Provider>;
}

export function usePlayerScore(): PlayerScoreControls {
  return useContext(PlayerScoreContext);
}
