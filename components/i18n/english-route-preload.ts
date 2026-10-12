"use client";

import { onceLoader, quietPreload } from "@/lib/shared/lazy-component";

/**
 * Les pages dont l'anglais se précharge (revue de performance du lot 9-2) —
 * **une seule table**, lue par le préchargement au survol
 * (`english-link-targets.ts`) et par les portes (`english-gates.tsx`). Chemins
 * sans préfixe, passés par `barePath` (requête, ancre et barre finale ôtées).
 */
export const ENGLISH_PAGES = {
  profile: /^\/profil$/,
  teamPage: /^\/equipes\/\d+$/,
  teams: /^\/equipes(\/creer)?$/,
  playerPage: /^\/joueurs\/\d+$/,
  players: /^\/joueurs$/,
  report: /^\/signalements\/\d+$/,
} as const satisfies Record<string, RegExp>;

export type EnglishPage = keyof typeof ENGLISH_PAGES;

/** Le chemin sans requête, ancre ni barre finale. */
export function barePath(path: string): string {
  const bare = path.split(/[?#]/)[0];
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

const ENTRIES = Object.entries(ENGLISH_PAGES) as Array<[EnglishPage, RegExp]>;

/** La page de la table que désigne `path`, ou `null`. */
export function englishPageOf(path: string): EnglishPage | null {
  const bare = barePath(path);
  return ENTRIES.find(([, pattern]) => pattern.test(bare))?.[0] ?? null;
}

const targets = onceLoader(() => import("./english-link-targets"));
/** Les pages demandées pendant que la table arrive : toutes servies à son arrivée. */
const wanted = new Set<EnglishPage>();
/** Un seul essai en vol : les survols pendant l'arrivée ne font qu'ajouter leur page. */
let warming = false;
const warmTargets = quietPreload(() => {
  warming = true;
  return targets.load().then(
    (module) => {
      warming = false;
      for (const page of wanted) module.preloadEnglishPage(page);
      wanted.clear();
    },
    (error: unknown) => {
      // Rien n'est gardé d'un essai raté : le prochain survol après le silence dit ce qu'il faut.
      warming = false;
      wanted.clear();
      throw error;
    },
  );
});

/**
 * Lance l'anglais de la page `path` (sans préfixe, `/equipes/5`) — survol d'un
 * lien ou navigation par le code sous `/en` (`EnglishLinkPreload`). Une page
 * hors de la table ne télécharge rien ; sinon la table des chargeurs arrive au
 * premier appel, un échec se taisant `PRELOAD_RETRY_MS` (`quietPreload`).
 */
export function preloadEnglishRoute(path: string): void {
  const page = englishPageOf(path);
  if (!page) return;
  const loaded = targets.loaded();
  if (loaded) {
    loaded.preloadEnglishPage(page);
    return;
  }
  if (warming) {
    wanted.add(page);
    return;
  }
  // Pendant le silence d'un échec, rien n'est retenu.
  if (warmTargets()) wanted.add(page);
}
