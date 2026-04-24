import { ReactNode } from "react";

interface PillProps {
  variant?: "default" | "live" | "blue";
  children: ReactNode;
  className?: string;
}

export function Pill({ variant = "default", children, className = "" }: PillProps) {
  const classes = [
    "pill",
    variant === "live" && "pill-live",
    variant === "blue" && "pill-blue",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      {variant === "live" && <span className="dot" />}
      {children}
    </span>
  );
}
