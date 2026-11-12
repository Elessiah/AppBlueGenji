"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * La requête média `query` est-elle satisfaite ? `null` côté serveur et au
 * premier rendu d'hydratation (la largeur n'y est pas connue) : l'appelant rend
 * alors ce que le CSS sait trier seul, puis la seule variante utile une fois
 * monté. Suit les changements (rotation, fenêtre redimensionnée).
 */
export function useMediaMatch(query: string): boolean | null {
  const subscribe = useCallback((onChange: () => void) => subscribeMediaQuery(query, onChange), [query]);
  const getSnapshot = useCallback(() => mediaQueryList(query).matches, [query]);
  return useSyncExternalStore<boolean | null>(subscribe, getSnapshot, () => null);
}

/**
 * Abonne `onChange` aux bascules de `query` ; rend le désabonnement. Safari
 * antérieur à 14 ne connaît que `addListener` : l'appel moderne y lèverait et
 * ferait tomber toute la mise en page.
 */
export function subscribeMediaQuery(query: string, onChange: () => void): () => void {
  const list = mediaQueryList(query);
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }
  list.addListener(onChange);
  return () => list.removeListener(onChange);
}

/** Une seule `MediaQueryList` par requête : lue à chaque rendu, jamais réallouée. */
const mediaQueryLists = new Map<string, MediaQueryList>();
export function mediaQueryList(query: string): MediaQueryList {
  let list = mediaQueryLists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    mediaQueryLists.set(query, list);
  }
  return list;
}

/** Largeur étroite commune (téléphone) : barre de navigation et arbre final de BlueGenji Survie basculent ensemble. */
export const NARROW_LAYOUT_QUERY = "(max-width: 720px)";

/** Quelles copies rendre d'un élément dupliqué bureau / largeur étroite (`narrow` : `useMediaMatch`). */
export function responsiveCopies(narrow: boolean | null): { desktop: boolean; narrow: boolean } {
  return { desktop: narrow !== true, narrow: narrow !== false };
}
