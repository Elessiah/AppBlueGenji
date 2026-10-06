"use client";

import { createContext, Fragment, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { shellText, type ShellMessages, type ShellText } from "@/lib/shared/shell-text";

/**
 * Textes de la coquille côté client (`lib/shared/shell-text.ts`).
 *
 * La mise en page racine pose ce fournisseur avec les messages de la langue de
 * la page — **aucun** pour le français, déjà inclus dans le paquet : une page
 * sans préfixe n'envoie aucun dictionnaire de plus. Hors fournisseur (tests,
 * `global-error`), les textes sont en français.
 */
const ShellTextContext = createContext<ShellText>(shellText(DEFAULT_LOCALE));

export function ShellTextProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: ShellMessages; children: ReactNode }>) {
  const value = useMemo(() => shellText(locale, messages), [locale, messages]);
  return <ShellTextContext.Provider value={value}>{children}</ShellTextContext.Provider>;
}

export function useShellText(): ShellText {
  return useContext(ShellTextContext);
}

/** Morceaux d'un texte riche (`ShellText.rich`) prêts à rendre, chacun sous sa clé. */
export function richNodes(parts: ReadonlyArray<ReactNode>): ReactNode {
  return parts.map((part, index) => (typeof part === "string" ? part : <Fragment key={index}>{part}</Fragment>));
}
