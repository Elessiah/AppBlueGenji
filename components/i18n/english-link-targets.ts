"use client";

import { englishPageOf, type EnglishPage } from "./english-pages";
import { preloadMissing } from "@/lib/shared/lazy-component";
import { PAGE_LOADERS } from "./english-page-loaders";
import { preloadProfileEnglish } from "./profile-english";

/*
 * Ce que précharge le survol ou le focus d'un lien `/en/…` de l'espace
 * connecté, ou une navigation par le code (`EnglishLinkPreload`, revue de
 * performance du lot 9-2) : l'anglais de la page visée part avant la réponse
 * du routeur. Module chargé lui-même au premier besoin.
 */


/** Le préchargement de chaque page (survol, navigation par le code) — dans ce morceau à la demande. */
const PAGE_PRELOADS: Record<keyof typeof PAGE_LOADERS, () => void> = {
  teamPage: preloadMissing(PAGE_LOADERS.teamPage),
  teams: preloadMissing(PAGE_LOADERS.teams),
  playerPage: preloadMissing(PAGE_LOADERS.playerPage),
  players: preloadMissing(PAGE_LOADERS.players),
  report: preloadMissing(PAGE_LOADERS.report),
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
