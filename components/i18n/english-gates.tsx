"use client";

import { useEffect, type ReactNode } from "react";
import { quietPreload } from "@/lib/shared/lazy-component";
import { useLocalePathname } from "./locale-navigation";
import { englishPageOf } from "./english-route-preload";
import { PAGE_LOADERS } from "./english-page-loaders";
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
 * Une porte extérieure (`/equipes`, `/joueurs`) **qui attend** son anglais ne
 * monte pas encore la porte de la fiche (`/equipes/5`, `/joueurs/5`) : elle
 * lance donc aussi, en même temps, l'anglais de la fiche visée — sans quoi les
 * deux morceaux partiraient l'un après l'autre. Rien une fois l'anglais là (la
 * fiche, montée, charge le sien) ; un échec se tait `PRELOAD_RETRY_MS`
 * (`quietPreload`) au lieu de repartir à chaque navigation.
 */
type NestedPage = "teamPage" | "teams" | "playerPage";
const NESTED_PRELOADS: Record<NestedPage, () => boolean> = {
  teamPage: quietPreload(() => Promise.all(PAGE_LOADERS.teamPage.map((loader) => loader.load()))),
  teams: quietPreload(() => Promise.all(PAGE_LOADERS.teams.map((loader) => loader.load()))),
  playerPage: quietPreload(() => Promise.all(PAGE_LOADERS.playerPage.map((loader) => loader.load()))),
};

function useNestedEnglish(locale: Locale, pages: ReadonlyArray<NestedPage>, waiting: boolean): void {
  // Le chemin suivi : une navigation sous une porte qui attend encore la relance.
  const { path } = useLocalePathname();
  useEffect(() => {
    if (locale !== "en" || !waiting) return;
    const page = englishPageOf(path);
    const nested = pages.find((candidate) => candidate === page);
    if (nested) NESTED_PRELOADS[nested]();
  }, [locale, waiting, path, pages]);
}

/** Les pages de la table (`ENGLISH_PAGES`) sous chaque porte extérieure. */
const TEAM_ROUTES = ["teamPage", "teams"] as const;
const PLAYER_ROUTES = ["playerPage"] as const;

/** `/equipes` et ses sous-pages : la table des refus d'équipe. */
export function TeamErrorsTextGate({ locale, messages, fallback, children }: GateProps<Messages["teamErrors"]>) {
  const { english, failed } = useEnglishMessages(locale, englishTeamErrors, messages);
  useNestedEnglish(locale, TEAM_ROUTES, !english && !failed);
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
  useNestedEnglish(locale, PLAYER_ROUTES, !english && !failed);
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
