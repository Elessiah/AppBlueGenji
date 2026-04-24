import { CSSProperties } from "react";
import styles from "./TeamSigil.module.css";

interface TeamSigilProps {
  letter: string;
  color?: string;
  size?: 24 | 32 | 40;
}

export function TeamSigil({
  letter,
  color = "var(--blue-500)",
  size = 32,
}: TeamSigilProps) {
  const radius = size === 24 ? "4px" : size === 32 ? "6px" : "6px";

  return (
    <div
      className={styles.root}
      style={
        {
          "--c": color,
          "--size": `${size}px`,
          "--radius": radius,
        } as CSSProperties
      }
    >
      {letter.toUpperCase()}
    </div>
  );
}
