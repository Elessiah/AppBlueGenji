"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { FR_LANDING_MESSAGES, landingText, type LandingClientMessages, type LandingText } from "@/lib/shared/landing-text";

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
}: Readonly<{ locale: Locale; messages?: LandingClientMessages; children: ReactNode }>) {
  // Seuls les espaces clients voyagent (`landingClientMessages`) ; les autres,
  // qu'aucun composant client ne lit, gardent ceux du paquet.
  const value = useMemo(
    () => landingText(locale, messages ? { ...FR_LANDING_MESSAGES, ...messages } : undefined),
    [locale, messages],
  );
  return <LandingTextContext.Provider value={value}>{children}</LandingTextContext.Provider>;
}

export function useLandingText(): LandingText {
  return useContext(LandingTextContext);
}
