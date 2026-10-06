"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { botClientText, type BotClientMessages, type BotClientText } from "@/lib/shared/bot-client-text";
import type { Locale } from "@/lib/shared/locales";

/**
 * Textes des composants client de `/bot` (bande d'état, flux temps réel) —
 * `lib/shared/bot-text.ts`. Hors fournisseur (tests, écran rendu ailleurs) :
 * le français du paquet.
 */
const BotTextContext = createContext<BotClientText>(botClientText());

export function BotTextProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: BotClientMessages; children: ReactNode }>) {
  // `messages` n'est passé que sous `/en` : une page française ne sérialise
  // aucun dictionnaire, son texte est déjà dans le paquet.
  const value = useMemo(() => botClientText(locale, messages), [locale, messages]);
  return <BotTextContext.Provider value={value}>{children}</BotTextContext.Provider>;
}

export function useBotText(): BotClientText {
  return useContext(BotTextContext);
}
