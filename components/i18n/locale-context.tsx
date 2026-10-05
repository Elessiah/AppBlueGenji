"use client";

import { NextIntlClientProvider } from "next-intl";
import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, SITE_TIME_ZONE, type Locale } from "@/lib/shared/locales";
import type { MessageNamespace, Messages } from "@/lib/shared/i18n-messages";

/**
 * Langue de la page côté client.
 *
 * Contexte propre, en plus de celui de `next-intl` : il vaut `fr` hors de tout
 * fournisseur, si bien qu'un lien (`LocaleLink`, `TeamLink`…) se rend sans
 * fournisseur — dans un test comme dans un composant pas encore migré. Un
 * `useLocale()` de `next-intl` y lèverait une erreur.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function useAppLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * Fournit la langue **et** les messages des espaces de noms choisis à un
 * sous-arbre client. Rendu par `IntlMessages` (serveur), qui choisit les
 * espaces — jamais le catalogue entier.
 */
export function AppIntlProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages: Partial<Pick<Messages, MessageNamespace>>; children: ReactNode }>) {
  return (
    <LocaleContext.Provider value={locale}>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone={SITE_TIME_ZONE}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
