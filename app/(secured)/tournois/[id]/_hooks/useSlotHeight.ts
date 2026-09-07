"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MIN_SLOT_HEIGHT, slotUnitHeight } from "../_lib/bracket-layout";

/**
 * Mesure la plus haute carte d'un tableau et en fait la hauteur de créneau.
 *
 * La hauteur ne peut pas se déduire du modèle : elle dépend des actions
 * offertes au lecteur (arbitrage, engagement, diffusion), du format du match et
 * du repli des noms d'équipe. On la **mesure** donc, et un `ResizeObserver`
 * refait le calcul quand une carte change de taille — le plateau arrive par le
 * flux SSE, une rangée peut apparaître longtemps après le premier rendu.
 *
 * Aucune boucle à craindre : le contenu mesuré est de hauteur automatique et
 * seulement *centré* dans son créneau, sa taille ne dépend donc pas de la
 * hauteur qu'on en déduit.
 */

/** Le rendu serveur n'a pas de mise en page : `useEffect` y remplace le layout. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface SlotMeasure {
  /** Hauteur uniforme d'un créneau, jamais inférieure au plancher. */
  slotHeight: number;
  /** `ref` à poser sur le contenu d'un créneau (libellé + carte). */
  measureSlot: (key: number) => (element: HTMLElement | null) => void;
}

export function useSlotHeight(): SlotMeasure {
  const [slotHeight, setSlotHeight] = useState(MIN_SLOT_HEIGHT);
  const nodes = useRef<Map<number, HTMLElement>>(new Map());
  const observer = useRef<ResizeObserver | null>(null);

  const recompute = useCallback(() => {
    const heights: number[] = [];
    for (const node of nodes.current.values()) {
      heights.push(node.getBoundingClientRect().height);
    }
    const next = slotUnitHeight(heights);
    setSlotHeight((previous) => (previous === next ? previous : next));
  }, []);

  const measureSlot = useCallback(
    (key: number) => (element: HTMLElement | null) => {
      const previous = nodes.current.get(key);
      if (previous) observer.current?.unobserve(previous);
      if (!element) {
        nodes.current.delete(key);
        return;
      }
      nodes.current.set(key, element);
      if (!observer.current && typeof ResizeObserver !== "undefined") {
        observer.current = new ResizeObserver(recompute);
      }
      observer.current?.observe(element);
    },
    [recompute],
  );

  // À chaque rendu : les cartes viennent d'être posées ou remplacées, et la
  // mesure doit précéder la peinture pour éviter un saut de mise en page.
  useIsomorphicLayoutEffect(recompute);

  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    [],
  );

  return { slotHeight, measureSlot };
}
