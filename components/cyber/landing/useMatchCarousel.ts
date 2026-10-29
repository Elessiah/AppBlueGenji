"use client";

import { useEffect, useRef, useState, type FocusEvent, type PointerEvent, type RefObject } from "react";
import { useClientPower, useClientPowerInput } from "@/lib/shared/hooks/useClientPower";
import type { ClientPowerInput } from "@/lib/shared/client-power";

/** Durée d'affichage d'un match avant de passer au suivant. */
export const LANDING_CAROUSEL_INTERVAL_MS = 7_000;

/**
 * Prise posée par un toucher : le match touché reste affiché tant que le doigt
 * revient dans ce délai, puis le défilement reprend seul. Le doigt n'a pas de
 * « sortie » qui relâcherait la prise comme la souris : sans échéance, le
 * carrousel resterait figé pour toujours après un premier toucher.
 */
export const LANDING_CAROUSEL_TOUCH_HOLD_MS = 10_000;

/**
 * Un appui retient-il le carrousel ? Le toucher et le stylet, oui : sans cela,
 * le match change toutes les sept secondes pendant la lecture, et un
 * tapotement au moment du changement ouvre l'ancre du match suivant. La souris
 * a déjà le survol ; un bouton de la carte (précédent, suivant, pause) règle
 * lui-même le défilement — retenu, « Reprendre » paraîtrait sans effet.
 */
export function pointerDownHoldsCarousel(pointerType: string, onButton: boolean): boolean {
  return pointerType !== "mouse" && !onButton;
}

/**
 * Index du match affiché : celui qu'on regardait s'il est encore dans la liste
 * (un sondage de `useLandingLive` la renouvelle), sinon le match mis en avant,
 * sinon le premier. Suivre un **identifiant** plutôt qu'un index évite qu'un
 * match terminé entre deux sondages décale la carte sur son voisin.
 */
export function resolveCarouselIndex(
  ids: readonly number[],
  activeId: number | null,
  featuredId: number | null,
): number {
  const active = activeId === null ? -1 : ids.indexOf(activeId);
  if (active !== -1) return active;
  const featured = featuredId === null ? -1 : ids.indexOf(featuredId);
  return Math.max(featured, 0);
}

/**
 * Le défilement automatique peut-il reprendre sans que le lecteur change de
 * réglage ? Non sous un gel **durable** — mouvement réduit (système ou menu
 * d'accessibilité), rencontre en cours, machine à la peine. Un gel passager
 * (fenêtre sans focus, onglet caché) ne compte pas : il se lève seul.
 */
export function carouselCanAutoRotate(input: ClientPowerInput): boolean {
  return !input.reducedMotion && !input.motionSetting && !input.matchFocus && !input.performanceLimited;
}

export type MatchCarousel = {
  index: number;
  count: number;
  /** Le défilement tourne réellement en ce moment. */
  rotating: boolean;
  /**
   * Le défilement automatique existe pour ce lecteur (gel passager compris) :
   * sinon, un bouton « Pause » nommerait un mouvement qui n'a pas lieu.
   */
  autoRotates: boolean;
  /** Le lecteur a mis le défilement en pause (bouton). */
  paused: boolean;
  go: (delta: number) => void;
  togglePaused: () => void;
  /** Enveloppe de la carte, pour retrouver le focus qu'un retrait a perdu. */
  holdRef: RefObject<HTMLDivElement>;
  /**
   * Survol à la souris, focus clavier ou toucher dans la carte : on ne fait pas
   * défiler sous le lecteur. Le toucher retient le carrousel pour
   * `LANDING_CAROUSEL_TOUCH_HOLD_MS` seulement (pas de sortie du pointeur au
   * doigt) ; le focus laissé par un clic ne le retient pas : il resterait
   * posé tant qu'on ne clique pas ailleurs, et le bouton « Reprendre »
   * paraîtrait sans effet.
   */
  holdHandlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
    onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
    onFocus: (event: FocusEvent<HTMLElement>) => void;
    onBlur: (event: FocusEvent<HTMLElement>) => void;
  };
};

/**
 * Carrousel des matchs de la carte « en cours ».
 *
 * Le défilement automatique est une animation au sens du régime de charge : il
 * ne tourne qu'avec `decorativeMotion` (figé onglet caché, page sans focus,
 * mouvement réduit, machine à la peine — `CLIENT_POWER_MODES.md`), et s'arrête
 * sous le pointeur, le focus ou le doigt, pour qu'un lecteur ne voie pas le match qu'il
 * s'apprêtait à ouvrir lui être retiré. Un bouton le met en pause (WCAG 2.2.2).
 *
 * Un `setTimeout` par match affiché plutôt qu'un `setInterval` : un geste du
 * lecteur (précédent / suivant) relance ainsi le délai entier.
 */
export function useMatchCarousel(ids: readonly number[], featuredId: number | null): MatchCarousel {
  const { decorativeMotion } = useClientPower();
  const autoRotates = carouselCanAutoRotate(useClientPowerInput());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const count = ids.length;
  // Match figé par la prise (survol, focus clavier) : il ne vaut que le temps de
  // la prise. Gardé au-delà, il empêcherait pour toujours la carte de suivre le
  // match mis en avant — chez qui rien ne défile (mouvement réduit), un match
  // entré à l'antenne ne serait jamais montré.
  const [heldId, setHeldId] = useState<number | null>(null);
  const held = hovered || focused || touched;
  const index = resolveCarouselIndex(ids, activeId ?? (held ? heldId : null), featuredId);
  const canRotate = count > 1 && decorativeMotion;
  const rotating = canRotate && !paused && !held;
  const nextId = count > 1 ? ids[(index + 1) % count] : null;

  // Un retrait sous le focus clavier — match terminé entre deux sondages, bouton
  // de diffusion d'un match qui quitte l'antenne, pause sous un gel durable —
  // n'émet aucun `blur` : la prise resterait posée pour toujours, et le focus
  // tomberait sur `<body>`. Relu après **chaque** rendu de la carte (`ids` est
  // un tableau neuf à chacun), donc dans le rendu même du retrait : le focus
  // perdu revient dans la carte, au bouton « suivant » ou à défaut à la plaque
  // de lien ; parti ailleurs — ou carte démontée —, il relâche la prise. Jamais
  // plus tard : rendre le focus des minutes après ramènerait la page au hero.
  const holdRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focused) return;
    const hold = holdRef.current;
    if (hold?.contains(document.activeElement)) return;
    if (hold && (document.activeElement === null || document.activeElement === document.body)) {
      const fallback = hold.querySelector<HTMLElement>("[data-carousel-next]") ?? hold.querySelector<HTMLElement>("a");
      if (fallback) {
        fallback.focus({ preventScroll: true });
        return;
      }
    }
    setFocused(false);
  }, [focused, ids]);

  /**
   * Fige le match affiché dès que le lecteur s'y arrête : tant qu'il n'a ni
   * défilé ni navigué, la carte suit le match mis en avant, qu'un sondage peut
   * changer — et remplacer sous ses yeux le match qu'il allait ouvrir. Posé à
   * l'entrée de la prise seulement : un second contrôle survolé ou focalisé ne
   * le déplace pas.
   */
  const pin = () => {
    if (!held) setHeldId(ids[index] ?? null);
  };

  /** Lève la prise du toucher et son échéance. */
  const releaseTouch = () => {
    if (touchTimer.current !== null) clearTimeout(touchTimer.current);
    touchTimer.current = null;
    setTouched(false);
  };

  // L'échéance du toucher ne survit pas à la carte.
  useEffect(
    () => () => {
      if (touchTimer.current !== null) clearTimeout(touchTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!rotating || nextId === null) return;
    const timer = setTimeout(() => setActiveId(nextId), LANDING_CAROUSEL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [rotating, nextId, index]);

  return {
    index,
    count,
    rotating,
    autoRotates: count > 1 && autoRotates,
    paused,
    go: (delta) => {
      if (count === 0) return;
      setActiveId(ids[(((index + delta) % count) + count) % count]);
    },
    // « Pause » / « Reprendre » règle le défilement à lui seul : une prise
    // tactile encore posée (match touché juste avant) le tenait figé jusqu'à
    // son échéance, et « Reprendre » paraissait sans effet pendant 10 s.
    togglePaused: () => {
      releaseTouch();
      setPaused((value) => !value);
    },
    holdRef,
    holdHandlers: {
      onPointerDown: (event) => {
        const onButton = event.target instanceof Element && event.target.closest("button") !== null;
        if (!pointerDownHoldsCarousel(event.pointerType, onButton)) return;
        pin();
        setTouched(true);
        // Chaque toucher repousse l'échéance : la prise dure tant qu'on lit.
        if (touchTimer.current !== null) clearTimeout(touchTimer.current);
        touchTimer.current = setTimeout(() => {
          touchTimer.current = null;
          setTouched(false);
        }, LANDING_CAROUSEL_TOUCH_HOLD_MS);
      },
      // `pointercancel` : le navigateur a repris le geste pour défiler la page.
      // Ce n'était pas une lecture de la carte — la prise posée par l'appui
      // qui l'a commencé tombe, au lieu de figer la carte 10 s.
      onPointerCancel: (event) => {
        if (event.pointerType !== "mouse") releaseTouch();
      },
      onPointerEnter: (event) => {
        if (event.pointerType !== "mouse") return;
        pin();
        setHovered(true);
      },
      onPointerLeave: (event) => {
        if (event.pointerType === "mouse") setHovered(false);
      },
      // `:focus-visible` : focus posé au clavier, pas par un clic de souris.
      onFocus: (event) => {
        const keyboard = event.target.matches(":focus-visible");
        if (keyboard) pin();
        setFocused(keyboard);
      },
      onBlur: (event) => {
        // Le focus passe d'un contrôle de la carte à un autre : on garde la main.
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false);
      },
    },
  };
}
