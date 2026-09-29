"use client";

import { useCallback, useState } from "react";
import { DIRECTORY_PAGE_SIZE, hiddenCount, nextVisibleCount } from "@/lib/shared/progressive-list";

/**
 * Borne le rendu d'une liste à une page, étendue par `showMore`.
 *
 * `resetKey` décrit les filtres : quand elle change, la liste repart sur sa
 * première page. La clé est gardée **à côté** du compte plutôt que remise à
 * zéro par un effet — un effet rendrait d'abord toute la liste dépliée sous
 * les nouveaux filtres, puis la replierait.
 */
export function useProgressiveList<T>(items: readonly T[], resetKey: string) {
  const [state, setState] = useState({ key: resetKey, count: DIRECTORY_PAGE_SIZE });
  const count = state.key === resetKey ? state.count : DIRECTORY_PAGE_SIZE;

  const showMore = useCallback(() => {
    setState({ key: resetKey, count: nextVisibleCount(count, items.length) });
  }, [resetKey, count, items.length]);

  return {
    visible: items.slice(0, count),
    hidden: hiddenCount(count, items.length),
    showMore,
  };
}
