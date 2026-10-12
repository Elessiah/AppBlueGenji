"use client";

import { englishPageOf, type EnglishPage } from "./english-route-preload";
import { PAGE_PRELOADS } from "./english-page-loaders";
import { preloadProfileEnglish } from "./profile-english";

/**
 * Ce que précharge le survol ou le focus d'un lien `/en/…` de l'espace
 * connecté, ou une navigation par le code (`EnglishLinkPreload`, revue de
 * performance du lot 9-2) : l'anglais de la page visée part avant la réponse
 * du routeur. Chargé lui-même au premier besoin.
 */
const PRELOADS: Record<EnglishPage, () => void> = {
  profile: () => preloadProfileEnglish("en"),
  ...PAGE_PRELOADS,
};

export function preloadEnglishPage(page: EnglishPage): void {
  PRELOADS[page]();
}

/** Le chemin sans préfixe (`/equipes/5`), requête et ancre ôtées. */
export function preloadEnglishFor(path: string): void {
  const page = englishPageOf(path);
  if (page) preloadEnglishPage(page);
}
