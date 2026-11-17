"use client";

import { useCallback, useEffect, useState } from "react";
import { arrowKey, pickArrowTarget, type ArrowDirection } from "@/lib/shared/arrow-refocus";

/**
 * Rend le focus à la flèche pressée après un déplacement (`lib/shared/arrow-refocus.ts`).
 * `refocusArrow(id, sens)` se pose quand l'ordre affiché change (aperçu
 * optimiste, retour à l'ordre d'avant sur un refus) ; le focus est rendu après
 * le rendu qui a déplacé la carte — seulement s'il a été perdu (tombé sur le
 * `<body>`) ou s'il est déjà sur l'une de ses flèches : un focus parti ailleurs
 * entre-temps n'est pas repris.
 */
export function useArrowRefocus(list: string): (id: number, direction: ArrowDirection) => void {
  const [target, setTarget] = useState<{ id: number; direction: ArrowDirection } | null>(null);
  useEffect(() => {
    if (!target) return;
    setTarget(null);
    const find = (direction: ArrowDirection) =>
      document.querySelector<HTMLButtonElement>(`[data-arrow="${arrowKey(list, target.id, direction)}"]`);
    const pressed = find(target.direction);
    const opposite = find(target.direction === "up" ? "down" : "up");
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (!lost && active !== pressed && active !== opposite) return;
    pickArrowTarget(pressed, opposite)?.focus();
  }, [list, target]);
  return useCallback((id: number, direction: ArrowDirection) => setTarget({ id, direction }), []);
}
