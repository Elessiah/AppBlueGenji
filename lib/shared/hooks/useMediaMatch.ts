"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * La requête média `query` est-elle satisfaite ? `null` côté serveur et au
 * premier rendu d'hydratation (la largeur n'y est pas connue) : l'appelant rend
 * alors ce que le CSS sait trier seul, puis la seule variante utile une fois
 * monté. Suit les changements (rotation, fenêtre redimensionnée).
 */
export function useMediaMatch(query: string): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore<boolean | null>(subscribe, () => window.matchMedia(query).matches, () => null);
}

/** Quelles copies rendre d'un élément dupliqué bureau / largeur étroite (`narrow` : `useMediaMatch`). */
export function responsiveCopies(narrow: boolean | null): { desktop: boolean; narrow: boolean } {
  return { desktop: narrow !== true, narrow: narrow !== false };
}
