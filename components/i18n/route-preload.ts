"use client";

/**
 * Le préchargement des navigations par le code (`useLocaleRouter`), **posé
 * de l'extérieur** (revue de performance du lot 9-2) : `locale-navigation.tsx`
 * sert chaque page, française comprise, et n'importe que ce registre — sans
 * `import()`, il n'ajoute aucun morceau à la table du runtime. Seule la mise
 * en page de l'espace connecté sous `/en` y inscrit le préchargement de
 * l'anglais (`EnglishLinkPreload`) ; ailleurs, rien ne se passe.
 */
let handler: ((path: string) => void) | null = null;

export function setRoutePreload(next: ((path: string) => void) | null): void {
  handler = next;
}

/** Prévient le préchargement inscrit, s'il y en a un, de la page `path` (sans préfixe). */
export function preloadRoute(path: string): void {
  handler?.(path);
}
