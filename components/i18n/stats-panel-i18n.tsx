"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { StatsPanelI18n } from "@/lib/shared/stats-text";

/**
 * Langue et messages du bloc de statistiques (`StatsPanel`, prop `i18n` prévue
 * au lot 4) pour les fiches équipe et joueur (lot 9) : posés par leur mise en
 * page sous `/en` seulement — en français, le bloc lit son paquet.
 */
const StatsPanelI18nContext = createContext<StatsPanelI18n | undefined>(undefined);

export function StatsPanelI18nProvider({ value, children }: Readonly<{ value?: StatsPanelI18n; children: ReactNode }>) {
  // Figé au premier rendu : un `router.refresh()` renvoie un objet neuf au
  // contenu identique, que le bloc prendrait pour une autre langue.
  const [stable] = useState(value);
  return <StatsPanelI18nContext.Provider value={stable}>{children}</StatsPanelI18nContext.Provider>;
}

/** Ce que la fiche passe à `StatsPanel i18n` ; `undefined` : le français. */
export function useStatsPanelI18n(): StatsPanelI18n | undefined {
  return useContext(StatsPanelI18nContext);
}
