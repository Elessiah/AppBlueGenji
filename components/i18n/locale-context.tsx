"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";

/**
 * Langue de la page côté client.
 *
 * Contexte propre, distinct de celui de `next-intl` : il vaut `fr` hors de tout
 * fournisseur, si bien qu'un lien (`LocaleLink`, `TeamLink`…) se rend sans
 * fournisseur — dans un test comme dans un composant pas encore migré. Et il ne
 * tire **aucun** code de `next-intl` : la mise en page racine le pose sur
 * toutes les pages sans alourdir celles qui n'ont rien de traduit.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function useAppLocale(): Locale {
  return useContext(LocaleContext);
}

/** Pose la langue de la page pour tout le sous-arbre client. */
export function AppLocaleProvider({ locale, children }: Readonly<{ locale: Locale; children: ReactNode }>) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
