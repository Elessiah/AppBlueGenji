"use client";

import { useCallback, useState } from "react";
import { DIRECTORY_PAGE_SIZE, hiddenCount, nextVisibleCount } from "@/lib/shared/progressive-list";

/**
 * Borne le rendu d'une liste à une page, étendue par `showMore`.
 *
 * `resetKey` décrit les filtres : quand elle change, la liste repart sur sa
 * première page. L'état est **réécrit pendant le rendu** (motif « ajuster
 * l'état quand une prop change » de React) plutôt que par un effet — un effet
 * rendrait d'abord toute la liste dépliée sous les nouveaux filtres, puis la
 * replierait — et plutôt que seulement comparé : garder l'ancienne clé ferait
 * revenir la liste dépliée dès qu'on rétablit les filtres d'avant.
 */
export function useProgressiveList<T>(items: readonly T[], resetKey: string) {
  const [state, setState] = useState({ key: resetKey, count: DIRECTORY_PAGE_SIZE });
  let count = state.count;
  if (state.key !== resetKey) {
    count = DIRECTORY_PAGE_SIZE;
    setState({ key: resetKey, count });
  }

  const showMore = useCallback(() => {
    setState((current) => ({ key: current.key, count: nextVisibleCount(current.count, items.length) }));
  }, [items.length]);

  return {
    visible: items.slice(0, count),
    hidden: hiddenCount(count, items.length),
    showMore,
  };
}
