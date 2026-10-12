"use client";

import { quietPreload } from "@/lib/shared/lazy-component";
import { englishReports } from "./english-loaders";
import { englishPlayers, englishStatsPanel, englishTeam, englishTeamErrors, englishTeams } from "./english-loaders-account";
import { englishPageOf, type EnglishPage } from "./english-route-preload";
import { preloadProfileEnglish } from "./profile-english";

/**
 * Ce que précharge le survol ou le focus d'un lien `/en/…` de l'espace
 * connecté, ou une navigation par le code (`EnglishLinkPreload`, revue de
 * performance du lot 9-2) : l'anglais de la page visée part avant la réponse
 * du routeur. Chargé lui-même au premier besoin.
 */
type Loader = { load(): Promise<unknown>; loaded(): unknown };

function group(...loaders: Loader[]): () => void {
  const preload = quietPreload(() => Promise.all(loaders.map((loader) => loader.load())));
  return () => {
    if (loaders.every((loader) => loader.loaded() !== null)) return;
    preload();
  };
}

/** Les chargeurs d'une page de la table (`ENGLISH_PAGES`) — repris par les portes. */
export const PAGE_LOADERS = {
  teamPage: [englishTeamErrors, englishTeam, englishStatsPanel],
  teams: [englishTeamErrors, englishTeams],
  playerPage: [englishPlayers, englishStatsPanel],
  players: [englishPlayers],
  report: [englishReports],
} as const satisfies Partial<Record<EnglishPage, readonly Loader[]>>;

const PRELOADS: Record<EnglishPage, () => void> = {
  profile: () => preloadProfileEnglish("en"),
  teamPage: group(...PAGE_LOADERS.teamPage),
  teams: group(...PAGE_LOADERS.teams),
  playerPage: group(...PAGE_LOADERS.playerPage),
  players: group(...PAGE_LOADERS.players),
  report: group(...PAGE_LOADERS.report),
};

export function preloadEnglishPage(page: EnglishPage): void {
  PRELOADS[page]();
}

/** Le chemin sans préfixe (`/equipes/5`), requête et ancre ôtées. */
export function preloadEnglishFor(path: string): void {
  const page = englishPageOf(path);
  if (page) preloadEnglishPage(page);
}
