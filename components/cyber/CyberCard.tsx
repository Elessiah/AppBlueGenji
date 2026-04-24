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
}

export function CyberCard({
  lift = false,
  ticks = false,
  as = "div",
  className = "",
  children,
  style,
}: CyberCardProps) {
  const classes = [
    styles.root,
    lift && styles.lift,
    ticks && "card-ticks",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return createElement(as, { className: classes, style }, children);
}
