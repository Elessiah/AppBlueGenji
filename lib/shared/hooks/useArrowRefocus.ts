"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { arrowKey, pickArrowTarget, type ArrowDirection } from "@/lib/shared/arrow-refocus";

// `useLayoutEffect` ne fait rien au rendu serveur (et React le signale) : la
// cible n'existe de toute façon qu'après un geste, côté navigateur.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Rend le focus à la flèche pressée après un déplacement (`lib/shared/arrow-refocus.ts`).
 * `refocusArrow(id, sens)` se pose quand l'ordre affiché change (aperçu
 * optimiste, retour à l'ordre d'avant sur un refus) ; le focus est rendu après
 * le rendu qui a déplacé la carte — seulement s'il a été perdu (tombé sur le
 * `<body>`) ou s'il est déjà sur l'une de ses flèches : un focus parti ailleurs
 * entre-temps n'est pas repris.
 *
 * La cible vit dans une `ref`, lue **avant la peinture** (`useLayoutEffect`) :
 * aucune image n'est peinte focus perdu, et la consommer ne coûte pas de rendu.
 * Le rendu qui l'applique est demandé par un compteur, groupé par React avec
 * la mise à jour de l'ordre faite dans le même geste : un seul rendu.
 */
export function useArrowRefocus(list: string): (id: number, direction: ArrowDirection) => void {
  const pending = useRef<{ id: number; direction: ArrowDirection } | null>(null);
  const [, requestRender] = useState(0);
  useIsomorphicLayoutEffect(() => {
    const target = pending.current;
    if (target === null) return;
    pending.current = null;
    const find = (direction: ArrowDirection) =>
      document.querySelector<HTMLButtonElement>(`[data-arrow="${arrowKey(list, target.id, direction)}"]`);
    const pressed = find(target.direction);
    const opposite = find(target.direction === "up" ? "down" : "up");
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (!lost && active !== pressed && active !== opposite) return;
    pickArrowTarget(pressed, opposite)?.focus();
  });
  return useCallback((id: number, direction: ArrowDirection) => {
    pending.current = { id, direction };
    requestRender((n) => n + 1);
  }, []);
}
