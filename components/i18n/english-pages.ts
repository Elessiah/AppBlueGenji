/*
 * Module pur, sans `import()` (revue de performance du lot 9-2) : les portes
 * des mises en page l'importent sans emporter la mécanique du préchargement.
 */

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
