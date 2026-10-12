"use client";

import { useEffect, type ReactNode } from "react";
import type { Locale } from "@/lib/shared/locales";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { StatsPanelMessages } from "@/lib/shared/stats-text";
import { englishPlayers, englishStatsPanel, englishTeam, englishTeamErrors } from "./english-loaders-account";
import { PlayersTextProvider } from "./players-text-provider";
import { StatsPanelI18nProvider } from "./stats-panel-i18n";
import { TeamErrorsTextProvider } from "./team-errors-text-provider";
import { TeamPageTextProvider } from "./team-page-text-provider";
import { useEnglishMessages } from "./use-english-messages";

/**
 * Les fournisseurs des équipes et des joueurs, posés par leurs mises en page
 * (revue de performance du lot 9-2, même règle que `/profil`) : l'anglais n'y
 * est sérialisé qu'au **chargement complet** d'une page (`isDocumentLoad`) —
 * jamais dans une réponse du routeur (navigation, préchargement de lien,
 * `router.refresh()` après un réglage d'équipe), qui n'est pas gardée par le
 * cache du navigateur. Le client garde ce que la session a reçu, sinon le
 * charge par les morceaux de `english-loaders.ts` (immuables, gardés par le
 * cache HTTP), `fallback` (l'écran de chargement du segment) affiché d'ici
 * là ; un échec retombe sur le français.
 */
type GateProps<T> = Readonly<{ locale: Locale; messages?: T; fallback: ReactNode; children: ReactNode }>;

/**
 * Une porte extérieure (`/equipes`, `/joueurs`) attendant son anglais ne monte
 * pas encore la porte de la fiche (`/equipes/5`, `/joueurs/5`) : elle lance
 * donc aussi, en même temps, l'anglais de la fiche visée — sans quoi les deux
 * morceaux partiraient l'un après l'autre.
 */
function useNestedEnglish(locale: Locale, pattern: RegExp, loaders: ReadonlyArray<{ load(): Promise<unknown> }>): void {
  useEffect(() => {
    if (locale !== "en" || !pattern.test(window.location.pathname)) return;
    for (const loader of loaders) loader.load().catch(() => undefined);
  }, [locale, pattern, loaders]);
}

const TEAM_PAGE_PATH = /^\/en\/equipes\/\d+\/?$/;
const TEAM_PAGE_LOADERS = [englishTeam, englishStatsPanel];
const PLAYER_PAGE_PATH = /^\/en\/joueurs\/\d+\/?$/;
const PLAYER_PAGE_LOADERS = [englishStatsPanel];

/** `/equipes` et ses sous-pages : la table des refus d'équipe. */
export function TeamErrorsTextGate({ locale, messages, fallback, children }: GateProps<Messages["teamErrors"]>) {
  const { english, failed } = useEnglishMessages(locale, englishTeamErrors, messages);
  useNestedEnglish(locale, TEAM_PAGE_PATH, TEAM_PAGE_LOADERS);
  if (locale === "en" && !english && !failed) return <>{fallback}</>;
  return (
    <TeamErrorsTextProvider locale={locale} messages={english ?? undefined}>
      {children}
    </TeamErrorsTextProvider>
  );
}

/** `/joueurs` et la fiche d'un joueur : l'espace `players`. */
export function PlayersTextGate({ locale, messages, fallback, children }: GateProps<Messages["players"]>) {
  const { english, failed } = useEnglishMessages(locale, englishPlayers, messages);
  useNestedEnglish(locale, PLAYER_PAGE_PATH, PLAYER_PAGE_LOADERS);
  if (locale === "en" && !english && !failed) return <>{fallback}</>;
  return (
    <PlayersTextProvider locale={locale} messages={english ?? undefined}>
      {children}
    </PlayersTextProvider>
  );
}

/** Le bloc de statistiques (fiche d'un joueur, d'une équipe). */
export function StatsPanelGate({ locale, messages, fallback, children }: GateProps<StatsPanelMessages>) {
  const { english, failed } = useEnglishMessages(locale, englishStatsPanel, messages);
  if (locale === "en" && !english && !failed) return <>{fallback}</>;
  return <StatsPanelI18nProvider value={english ? { locale, messages: english } : undefined}>{children}</StatsPanelI18nProvider>;
}

/** La fiche d'une équipe : l'espace `team` et le bloc de statistiques, chargés ensemble. */
export function TeamPageTextGate({
  locale,
  messages,
  stats,
  fallback,
  children,
}: GateProps<Messages["team"]> & Readonly<{ stats?: StatsPanelMessages }>) {
  const team = useEnglishMessages(locale, englishTeam, messages);
  const panel = useEnglishMessages(locale, englishStatsPanel, stats);
  const waiting = (state: { english: unknown; failed: boolean }) => !state.english && !state.failed;
  if (locale === "en" && (waiting(team) || waiting(panel))) return <>{fallback}</>;
  return (
    <TeamPageTextProvider locale={locale} messages={team.english ?? undefined}>
      <StatsPanelI18nProvider value={panel.english ? { locale, messages: panel.english } : undefined}>{children}</StatsPanelI18nProvider>
    </TeamPageTextProvider>
  );
}
