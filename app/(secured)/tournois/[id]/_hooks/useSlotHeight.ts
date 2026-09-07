"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MIN_SLOT_HEIGHT, type RoundMeasure, slotUnitHeight } from "../_lib/bracket-layout";

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
  /** Hauteur unitaire d'un créneau, jamais inférieure au plancher. */
  slotHeight: number;
  /**
   * `ref` à poser sur le contenu d'un créneau (libellé + carte).
   *
   * Le round est demandé parce que la hauteur se décide **par round** : c'est
   * lui qui porte l'effectif, et un round large n'a pas les mêmes besoins qu'une
   * finale seule dans sa colonne.
   */
  measureSlot: (roundNumber: number, matchId: number) => (element: HTMLElement | null) => void;
}

export function useSlotHeight(): SlotMeasure {
  const [slotHeight, setSlotHeight] = useState(MIN_SLOT_HEIGHT);
  const nodes = useRef<Map<number, { roundNumber: number; element: HTMLElement }>>(new Map());
  const observer = useRef<ResizeObserver | null>(null);

  const recompute = useCallback(() => {
    // L'effectif d'un round est le nombre de créneaux qu'il a rendus : c'est la
    // même liste que celle dont `BracketTree` tire sa géométrie.
    const rounds = new Map<number, RoundMeasure>();
    for (const { roundNumber, element } of nodes.current.values()) {
      const height = element.getBoundingClientRect().height;
      const round = rounds.get(roundNumber);
      if (!round) {
        rounds.set(roundNumber, { matchCount: 1, tallestContent: height });
        continue;
      }
      round.matchCount += 1;
      if (height > round.tallestContent) round.tallestContent = height;
    }
    const next = slotUnitHeight(rounds.values());
    setSlotHeight((previous) => (previous === next ? previous : next));
  }, []);

  const measureSlot = useCallback(
    (roundNumber: number, matchId: number) => (element: HTMLElement | null) => {
      const previous = nodes.current.get(matchId);
      if (previous) observer.current?.unobserve(previous.element);
      if (!element) {
        nodes.current.delete(matchId);
        return;
      }
      nodes.current.set(matchId, { roundNumber, element });
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
