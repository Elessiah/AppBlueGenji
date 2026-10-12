"use client";

import type { ReactNode } from "react";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import { englishTeams } from "./english-loaders-account";
import { TeamsTextProvider } from "./teams-text";
import { useEnglishMessages } from "./use-english-messages";

/**
 * Les textes de l'annuaire `/equipes` et de la création d'une équipe, posés
 * par leurs **pages** (même règle que les mises en page, revue de performance
 * du lot 9-2) : l'anglais n'est sérialisé qu'au chargement complet — jamais
 * à une navigation ni au `router.refresh()` qui suit une création. Module à
 * part de `english-gates.tsx` : il porte le français de `teams-text.tsx`,
 * que seules ces deux pages emportent.
 */
export function TeamsTextGate({
  locale,
  messages,
  fallback,
  children,
}: Readonly<{ locale: Locale; messages?: Messages["teams"]; fallback: ReactNode; children: ReactNode }>) {
  const { english, waiting } = useEnglishMessages(locale, englishTeams, messages);
  if (waiting) return <>{fallback}</>;
  return (
    <TeamsTextProvider locale={locale} messages={english ?? undefined}>
      {children}
    </TeamsTextProvider>
  );
}
