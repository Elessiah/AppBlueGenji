"use client";

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type FocusEvent, type ReactNode } from "react";
import {
  isOwnFocusEvent,
  releasesFocus,
  scrollAreaAccessibility,
  watchScrollOverflow,
} from "@/lib/shared/scroll-overflow";

type ScrollOrientation = "x" | "y" | "both";

interface ScrollAreaProps {
  children: ReactNode;
  /** Axe de défilement. `x` par défaut (cas le plus fréquent : rounds, tableaux). */
  orientation?: ScrollOrientation;
  /** Barre discrète, révélée au survol. Vrai par défaut. */
  subtle?: boolean;
  /**
   * Dégradé en bord de zone signalant qu'il reste du contenu à faire défiler.
   * Uniquement sur l'axe horizontal, où rien d'autre ne le laisse deviner.
   */
  fade?: boolean;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  /**
   * Nom de la zone. Posé, avec `role="region"`, **seulement** quand la zone
   * déborde : une zone qui ne défile pas n'est ni un arrêt de tabulation ni un
   * repère (`lib/shared/scroll-overflow.ts`).
   */
  ariaLabel?: string;
}

const OVERFLOW: Record<ScrollOrientation, CSSProperties> = {
  x: { overflowX: "auto", overflowY: "visible" },
  y: { overflowY: "auto", overflowX: "visible" },
  both: { overflow: "auto" },
};

// Masque les 18 derniers pixels : le contenu s'efface au lieu d'être tranché.
const FADE_MASK =
  "linear-gradient(to right, transparent 0, #000 18px, #000 calc(100% - 18px), transparent 100%)";

/**
 * Zone défilante du design system.
 *
 * Sert à ne plus recopier `overflowX: "auto"` à la main dans chaque composant, et
 * surtout à ne plus hériter de la barre blanche par défaut du navigateur : le
 * style des barres est global (`app/globals.css`), ce composant ajoute la
 * variante discrète, le dégradé de bord et le comportement de défilement.
 *
 * Une zone qui **déborde** est focalisable au clavier (`tabIndex={0}`), pour
 * être atteinte et pilotée aux flèches, et devient une région nommée dès qu'un
 * `ariaLabel` est fourni. Une zone dont le contenu tient n'est ni l'un ni
 * l'autre : le débordement est relu à chaque changement de taille de la zone ou
 * de ses enfants. Avant toute mesure — rendu serveur, hydratation — la zone est
 * focalisable : c'est le sens qui ne bloque personne.
 */
export function ScrollArea({
  children,
  orientation = "x",
  subtle = true,
  fade = false,
  as: Tag = "div",
  className,
  style,
  ariaLabel,
}: ScrollAreaProps) {
  const ref = useRef<HTMLElement>(null);
  // `true` tant que rien n'est mesuré : le rendu serveur et le premier rendu
  // client doivent coïncider, et le défaut prudent est « atteignable ».
  const [overflowing, setOverflowing] = useState(true);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return watchScrollOverflow(
      element,
      ({ overflowing: next, active }) => {
        setOverflowing(next);
        if (active) setFocused(true);
      },
      {
        ResizeObserver: typeof ResizeObserver === "undefined" ? undefined : ResizeObserver,
        MutationObserver: typeof MutationObserver === "undefined" ? undefined : MutationObserver,
        root: document.documentElement,
        fonts: document.fonts,
        activeElement: () => document.activeElement,
      },
    );
  }, []);

  const classes = ["scroll-area", subtle ? "scroll-subtle" : null, className]
    .filter(Boolean)
    .join(" ");

  const fadeStyle: CSSProperties =
    fade && orientation !== "y"
      ? { maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }
      : {};

  return (
    <Tag
      ref={ref}
      className={classes}
      {...scrollAreaAccessibility({ overflowing, focused, ariaLabel })}
      onFocus={(event: FocusEvent<HTMLElement>) => {
        if (isOwnFocusEvent(event)) setFocused(true);
      }}
      onBlur={(event: FocusEvent<HTMLElement>) => {
        const { target, currentTarget } = event;
        if (releasesFocus({ target, currentTarget, activeElement: document.activeElement })) setFocused(false);
      }}
      style={{ ...OVERFLOW[orientation], ...fadeStyle, ...style }}
    >
      {children}
    </Tag>
  );
}
