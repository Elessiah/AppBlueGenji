"use client";

import { useEffect, type ReactNode } from "react";
import { englishPageOf } from "./english-pages";
import { PAGE_LOADERS } from "./english-page-loaders";
import type { Locale } from "@/lib/shared/locales";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { StatsPanelMessages } from "@/lib/shared/stats-text";
import { englishPlayers, englishStatsPanel, englishTeam, englishTeamErrors } from "./english-loaders-account";
import { PlayersTextProvider } from "./players-text-provider";
import { StatsPanelI18nProvider } from "./stats-panel-i18n";
import { TeamErrorsTextProvider } from "./team-errors-text-provider";
import { TeamPageTextProvider } from "./team-page-text-provider";
import { usePathname } from "next/navigation";
import { useEnglishMessages, useEnglishMessagesAt } from "./use-english-messages";
import { EnglishGateFallback } from "./english-gate-fallback";
import { splitLocalePrefix } from "@/lib/shared/locales";

/**
 * Les fournisseurs des équipes et des joueurs, posés par leurs mises en page
 * (revue de performance du lot 9-2, même règle que `/profil`) : l'anglais n'y
 * est sérialisé qu'au **chargement complet** d'une page (`isDocumentLoad`) —
 * jamais dans une réponse du routeur (navigation, préchargement de lien,
 * `router.refresh()` après un réglage d'équipe), qui n'est pas gardée par le
 * cache du navigateur. Le client garde ce que la session a reçu, sinon le
 * charge par les morceaux de `english-loaders.ts` (immuables, gardés par le
 * cache HTTP), l'écran d'attente (`EnglishGateFallback`) affiché d'ici
 * là ; un échec retombe sur le français.
 */
type GateProps<T> = Readonly<{ locale: Locale; messages?: T; children: ReactNode }>;

/**
 * Une porte extérieure (`/equipes`, `/joueurs`) **qui attend** son anglais ne
 * monte pas encore la porte de la fiche (`/equipes/5`, `/joueurs/5`) : elle
 * lance donc aussi, en même temps, l'anglais de la fiche visée — sans quoi les
 * deux morceaux partiraient l'un après l'autre. Rien une fois l'anglais là (la
 * fiche, montée, charge le sien). Appel direct des chargeurs de la table
 * (`PAGE_LOADERS`), hors celui de la porte : `onceLoader` partage la requête
 * en vol et ne garde pas un échec — la porte retentant à chaque navigation, un
 * silence ici ne ferait que remettre les morceaux l'un après l'autre.
 */
type NestedPage = "teamPage" | "teams" | "playerPage";

function useNestedEnglish(
  locale: Locale,
  pages: ReadonlyArray<NestedPage>,
  own: { load(): Promise<unknown> },
  waiting: boolean,
  pathname: string | null,
): void {
  // Le chemin suivi (lu une fois par la porte) : une navigation sous une porte qui attend encore la relance.
  const path = pathname ?? "/";
  useEffect(() => {
    if (locale !== "en" || !waiting) return;
    const page = englishPageOf(splitLocalePrefix(path).path);
    const nested = pages.find((candidate) => candidate === page);
    if (!nested) return;
    for (const loader of PAGE_LOADERS[nested]) {
      if (loader !== own) loader.load().catch(() => undefined);
    }
  }, [locale, waiting, path, pages, own]);
}

/** Les pages de la table (`ENGLISH_PAGES`) sous chaque porte extérieure. */
const TEAM_ROUTES = ["teamPage", "teams"] as const;
const PLAYER_ROUTES = ["playerPage"] as const;

/** `/equipes` et ses sous-pages : la table des refus d'équipe. */
export function TeamErrorsTextGate({ locale, messages, children }: GateProps<Messages["teamErrors"]>) {
  const pathname = usePathname();
  const { english, waiting } = useEnglishMessagesAt(locale, englishTeamErrors, messages, pathname);
  useNestedEnglish(locale, TEAM_ROUTES, englishTeamErrors, waiting, pathname);
  if (waiting) return <EnglishGateFallback />;
  return (
    <TeamErrorsTextProvider locale={locale} messages={english ?? undefined}>
      {children}
    </TeamErrorsTextProvider>
  );
}

/** `/joueurs` et la fiche d'un joueur : l'espace `players`. */
export function PlayersTextGate({ locale, messages, children }: GateProps<Messages["players"]>) {
  const pathname = usePathname();
  const { english, waiting } = useEnglishMessagesAt(locale, englishPlayers, messages, pathname);
  useNestedEnglish(locale, PLAYER_ROUTES, englishPlayers, waiting, pathname);
  if (waiting) return <EnglishGateFallback />;
  return (
    <PlayersTextProvider locale={locale} messages={english ?? undefined}>
      {children}
    </PlayersTextProvider>
  );
}

/** Le bloc de statistiques (fiche d'un joueur, d'une équipe). */
export function StatsPanelGate({ locale, messages, children }: GateProps<StatsPanelMessages>) {
  const { english, waiting } = useEnglishMessages(locale, englishStatsPanel, messages);
  if (waiting) return <EnglishGateFallback />;
  return <StatsPanelI18nProvider value={english ? { locale, messages: english } : undefined}>{children}</StatsPanelI18nProvider>;
}

/** La fiche d'une équipe : l'espace `team` et le bloc de statistiques, chargés ensemble. */
export function TeamPageTextGate({
  locale,
  messages,
  stats,
  children,
}: GateProps<Messages["team"]> & Readonly<{ stats?: StatsPanelMessages }>) {
  // Le chemin lu une fois pour les deux espaces.
  const pathname = usePathname();
  const team = useEnglishMessagesAt(locale, englishTeam, messages, pathname);
  const panel = useEnglishMessagesAt(locale, englishStatsPanel, stats, pathname);
  if (team.waiting || panel.waiting) return <EnglishGateFallback />;
  return (
    <TeamPageTextProvider locale={locale} messages={team.english ?? undefined}>
      <StatsPanelI18nProvider value={panel.english ? { locale, messages: panel.english } : undefined}>{children}</StatsPanelI18nProvider>
    </TeamPageTextProvider>
  );
}
