"use client";

import { quietPreload } from "@/lib/shared/lazy-component";
import { englishReports } from "./english-loaders";
import { englishPlayers, englishStatsPanel, englishTeam, englishTeamErrors, englishTeams } from "./english-loaders-account";
import { preloadProfileEnglish } from "./profile-english";

/**
 * Ce que précharge le survol ou le focus d'un lien `/en/…` de l'espace
 * connecté (`EnglishLinkPreload`, revue de performance du lot 9-2) : l'anglais
 * de la page visée part avant le clic, et la page n'attend plus son morceau
 * après la réponse de navigation. Chargé lui-même au premier survol.
 */
type Loader = { load(): Promise<unknown>; loaded(): unknown };

function group(...loaders: Loader[]): () => void {
  const preload = quietPreload(() => Promise.all(loaders.map((loader) => loader.load())));
  return () => {
    if (loaders.every((loader) => loader.loaded() !== null)) return;
    preload();
  };
}

const TEAM_PAGE = group(englishTeamErrors, englishTeam, englishStatsPanel);
const TEAMS = group(englishTeamErrors, englishTeams);
const PLAYER_PAGE = group(englishPlayers, englishStatsPanel);
const PLAYERS = group(englishPlayers);
const REPORT = group(englishReports);

/** Le chemin sans préfixe (`/equipes/5`), requête et ancre ôtées. */
export function preloadEnglishFor(path: string): void {
  const bare = path.split(/[?#]/)[0];
  if (bare === "/profil") preloadProfileEnglish("en");
  else if (/^\/equipes\/\d+$/.test(bare)) TEAM_PAGE();
  else if (/^\/equipes(\/creer)?$/.test(bare)) TEAMS();
  else if (/^\/joueurs\/\d+$/.test(bare)) PLAYER_PAGE();
  else if (bare === "/joueurs") PLAYERS();
  else if (/^\/signalements\/\d+$/.test(bare)) REPORT();
}
