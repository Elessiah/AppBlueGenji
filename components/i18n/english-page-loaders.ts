"use client";

import { englishReports } from "./english-loaders";
import { englishPlayers, englishStatsPanel, englishTeam, englishTeamErrors, englishTeams } from "./english-loaders-account";
import type { EnglishPage } from "./english-pages";

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
