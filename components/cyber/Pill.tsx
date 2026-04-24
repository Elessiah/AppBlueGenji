import { ReactNode, CSSProperties } from "react";

interface PillProps {
  variant?: "default" | "live" | "blue";
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Pill({ variant = "default", children, className = "", style }: PillProps) {
  const classes = [
    "pill",
    variant === "live" && "pill-live",
    variant === "blue" && "pill-blue",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} style={style}>
      {variant === "live" && <span className="dot" />}
      {children}
    </span>
  );
}
