"use client";

import { englishPageOf, type EnglishPage } from "./english-pages";
import { quietPreload } from "@/lib/shared/lazy-component";
import { PAGE_LOADERS, type PageLoader } from "./english-page-loaders";
import { preloadProfileEnglish } from "./profile-english";

/*
 * Ce que précharge le survol ou le focus d'un lien `/en/…` de l'espace
 * connecté, ou une navigation par le code (`EnglishLinkPreload`, revue de
 * performance du lot 9-2) : l'anglais de la page visée part avant la réponse
 * du routeur. Module chargé lui-même au premier besoin.
 */

/** Précharge un groupe : rien s'il est déjà là, silence `PRELOAD_RETRY_MS` après un échec. */
function group(loaders: readonly PageLoader[]): () => void {
  const preload = quietPreload(() => Promise.all(loaders.map((loader) => loader.load())));
  return () => {
    if (loaders.every((loader) => loader.loaded() !== null)) return;
    preload();
  };
}

/** Le préchargement de chaque page (survol, navigation par le code) — dans ce morceau à la demande. */
const PAGE_PRELOADS: Record<keyof typeof PAGE_LOADERS, () => void> = {
  teamPage: group(PAGE_LOADERS.teamPage),
  teams: group(PAGE_LOADERS.teams),
  playerPage: group(PAGE_LOADERS.playerPage),
  players: group(PAGE_LOADERS.players),
  report: group(PAGE_LOADERS.report),
};

const PRELOADS: Record<EnglishPage, () => void> = {
  profile: () => preloadProfileEnglish("en"),
  ...PAGE_PRELOADS,
};

/** Lance l'anglais d'une page de la table (`ENGLISH_PAGES`). */
export function preloadEnglishPage(page: EnglishPage): void {
  PRELOADS[page]();
}

/** Le chemin sans préfixe (`/equipes/5`), requête et ancre ôtées. */
export function preloadEnglishFor(path: string): void {
  const page = englishPageOf(path);
  if (page) preloadEnglishPage(page);
}
