"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { SITE_TIME_ZONE, type Locale } from "@/lib/shared/locales";
import type { MessageNamespace, Messages } from "@/lib/shared/i18n-messages";
import { AppLocaleProvider } from "./locale-context";

/**
 * Fournit la langue **et** les messages des espaces de noms choisis à un
 * sous-arbre client. Rendu par `IntlMessages` (serveur), qui choisit les
 * espaces — jamais le catalogue entier.
 *
 * Seul fichier client à importer `next-intl` : le code de formatage
 * (~12 Ko compressés) n'est chargé que par les segments qui l'utilisent.
 */
export function AppIntlProvider({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages: Partial<Pick<Messages, MessageNamespace>>; children: ReactNode }>) {
  return (
    <AppLocaleProvider locale={locale}>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone={SITE_TIME_ZONE}>
        {children}
      </NextIntlClientProvider>
    </AppLocaleProvider>
  );
}
