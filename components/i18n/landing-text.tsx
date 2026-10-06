"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { landingText, type LandingMessages, type LandingText } from "@/lib/shared/landing-text";

/**
 * Textes de l'accueil côté client (`lib/shared/landing-text.ts`).
 *
 * L'accueil pose ce fournisseur avec les messages de sa langue — **aucun** en
 * français, déjà inclus dans le paquet : la page sans préfixe n'envoie aucun
 * dictionnaire de plus. Hors fournisseur (tests, pages pas encore traduites qui
 * réutilisent un composant de l'accueil), les textes sont en français.
 */
const LandingTextContext = createContext<LandingText>(landingText(DEFAULT_LOCALE));

export function LandingTextProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: LandingMessages; children: ReactNode }>) {
  const value = useMemo(() => landingText(locale, messages), [locale, messages]);
  return <LandingTextContext.Provider value={value}>{children}</LandingTextContext.Provider>;
}

export function useLandingText(): LandingText {
  return useContext(LandingTextContext);
}
