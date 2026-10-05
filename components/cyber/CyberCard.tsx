import { ReactNode, CSSProperties, createElement } from "react";
import styles from "./CyberCard.module.css";

type CardAs = "div" | "section" | "article";

interface CyberCardProps {
  lift?: boolean;
  ticks?: boolean;
  as?: CardAs;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
  /** Ancre DOM de la carte (cible d'un lien profond `#...`). */
  id?: string;
  /** Teinte de la carte (`data-tone`), lue par la feuille de la page qui la pose. */
  tone?: string;
}

export function CyberCard({
  lift = false,
  ticks = false,
  as = "div",
  className = "",
  children,
  style,
  id,
  tone,
}: Readonly<CyberCardProps>) {
  const classes = [
    styles.root,
    lift && styles.lift,
    ticks && "card-ticks",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return createElement(as, { className: classes, style, id, "data-tone": tone }, children);
}
