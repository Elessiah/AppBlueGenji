import type { CSSProperties, ElementType, ReactNode } from "react";

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
  /** Repris tel quel sur l'élément (utile pour `aria-label`, `role`, `tabIndex`). */
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
 * Le contenu défilable reste focalisable au clavier : `tabIndex={0}` est posé
 * automatiquement pour que la zone soit atteignable et pilotable aux flèches,
 * conformément aux règles d'accessibilité sur les régions défilantes.
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
  const classes = ["scroll-area", subtle ? "scroll-subtle" : null, className]
    .filter(Boolean)
    .join(" ");

  const fadeStyle: CSSProperties =
    fade && orientation !== "y"
      ? { maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }
      : {};

  return (
    <Tag
      className={classes}
      tabIndex={0}
      role={ariaLabel ? "region" : undefined}
      aria-label={ariaLabel}
      style={{ ...OVERFLOW[orientation], ...fadeStyle, ...style }}
    >
      {children}
    </Tag>
  );
}
