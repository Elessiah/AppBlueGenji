"use client";

import type { ReactNode } from "react";
import { englishReports } from "@/components/i18n/english-loaders";
import { useEnglishMessages } from "@/components/i18n/use-english-messages";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import { ReportsTextProvider } from "./reports-text-provider";

/**
 * Les textes de la page d'un signalement, posés par sa mise en page — sans
 * français (déjà dans le paquet de la page). Comme `/profil` (revue de
 * performance du lot 9-2) : l'anglais n'est sérialisé qu'au chargement complet
 * d'une page ; une navigation (d'un signalement à l'autre), un préchargement
 * ou un rafraîchissement n'en portent aucun — la session garde le sien
 * (`englishReports`, partagé avec le formulaire du pied de page), sinon il est
 * chargé à part, `fallback` affiché d'ici là. Un échec retombe sur le français.
 */
export function ConcernedReportsText({
  locale,
  messages,
  fallback,
  children,
}: Readonly<{ locale: Locale; messages?: Messages["reports"]; fallback: ReactNode; children: ReactNode }>) {
  const { english, failed } = useEnglishMessages(locale, englishReports, messages);
  if (locale === "en" && !english && !failed) return <>{fallback}</>;
  return (
    <ReportsTextProvider locale={locale} messages={english ?? undefined}>
      {children}
    </ReportsTextProvider>
  );
}
