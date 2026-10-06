"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { FR_LOGIN_TEXT, loginText, type LoginMessages, type LoginText } from "@/lib/shared/login-text";
import type { Locale } from "@/lib/shared/locales";

/**
 * Textes de la page de connexion côté client (`lib/shared/login-text.ts`).
 * Hors fournisseur — tests, écran rendu ailleurs —, le français du paquet.
 */
const LoginTextContext = createContext<LoginText>(FR_LOGIN_TEXT);

export function LoginTextProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: LoginMessages; children: ReactNode }>) {
  // `messages` n'est passé que sous `/en` : une page française ne sérialise
  // aucun dictionnaire, son texte est déjà dans le paquet.
  const value = useMemo(() => loginText(locale, messages), [locale, messages]);
  return <LoginTextContext.Provider value={value}>{children}</LoginTextContext.Provider>;
}

export function useLoginText(): LoginText {
  return useContext(LoginTextContext);
}
