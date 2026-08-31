"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { BracketMatch } from "@/lib/shared/types";

type IssueReportControls = {
  /**
   * Le viewer est-il engagé dans ce tournoi ? Seul un inscrit signale un
   * problème : le bouton n'est pas un formulaire de contact, il fait sonner le
   * téléphone des arbitres.
   */
  canReport: boolean;
  /** Ouvre le signalement sur une manche, ou sur le tournoi entier (`null`). */
  openReport: (match: BracketMatch | null) => void;
};

const IssueReportContext = createContext<IssueReportControls>({
  canReport: false,
  openReport: () => undefined,
});

/**
 * Signalement de problème, diffusé par contexte.
 *
 * Même motif que `LiveProvider` : `MatchRow` est rendu depuis six vues (arbre,
 * survie, suisse, endurance, sections, phases), et faire descendre le droit et
 * l'ouverture du dialogue en props obligerait chacune à relayer deux valeurs
 * qui ne la concernent pas.
 */
export function IssueReportProvider({
  canReport,
  openReport,
  children,
}: IssueReportControls & { children: ReactNode }) {
  const value = useMemo(() => ({ canReport, openReport }), [canReport, openReport]);
  return <IssueReportContext.Provider value={value}>{children}</IssueReportContext.Provider>;
}

export function useIssueReport(): IssueReportControls {
  return useContext(IssueReportContext);
}
