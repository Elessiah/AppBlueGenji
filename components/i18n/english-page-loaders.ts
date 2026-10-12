"use client";

import { quietPreload } from "@/lib/shared/lazy-component";
import { englishReports } from "./english-loaders";
import { englishPlayers, englishStatsPanel, englishTeam, englishTeamErrors, englishTeams } from "./english-loaders-account";
import type { EnglishPage } from "./english-route-preload";

/**
 * Les chargeurs d'anglais de chaque page de la table (`ENGLISH_PAGES`) — **la
 * seule** correspondance page → espaces : le survol (`english-link-targets.ts`)
 * et les portes (`english-gates.tsx`) la lisent. `/profil` passe par son
 * chargeur composé (`profile-english.ts`).
 */
export type PageLoader = { load(): Promise<unknown>; loaded(): unknown };

export const PAGE_LOADERS = {
  teamPage: [englishTeamErrors, englishTeam, englishStatsPanel],
  teams: [englishTeamErrors, englishTeams],
  playerPage: [englishPlayers, englishStatsPanel],
  players: [englishPlayers],
  report: [englishReports],
} as const satisfies Record<Exclude<EnglishPage, "profile">, readonly PageLoader[]>;

/** Précharge un groupe : rien s'il est déjà là, silence `PRELOAD_RETRY_MS` après un échec. */
function group(loaders: readonly PageLoader[]): () => void {
  const preload = quietPreload(() => Promise.all(loaders.map((loader) => loader.load())));
  return () => {
    if (loaders.every((loader) => loader.loaded() !== null)) return;
    preload();
  };
}

/** Le préchargement de chaque page (survol, navigation par le code) — un par page, partagé. */
export const PAGE_PRELOADS: Record<keyof typeof PAGE_LOADERS, () => void> = {
  teamPage: group(PAGE_LOADERS.teamPage),
  teams: group(PAGE_LOADERS.teams),
  playerPage: group(PAGE_LOADERS.playerPage),
  players: group(PAGE_LOADERS.players),
  report: group(PAGE_LOADERS.report),
};
