import { CSSProperties } from "react";
import { TEAM_TAG_MAX_LENGTH } from "@/lib/shared/team-tag";
import styles from "./TeamSigil.module.css";

interface TeamSigilProps {
  /**
   * Ce que porte l'emblème : le sigle d'une équipe (jusqu'à
   * `TEAM_TAG_MAX_LENGTH` caractères) ou de simples initiales. Le composant
   * s'appelait `letter` et ne dimensionnait rien : la case étant carrée et de
   * taille fixe, tout ce qui dépassait un caractère débordait du cadre.
   */
  label: string;
  color?: string;
  size?: 24 | 32 | 40;
}

/**
 * Part de la hauteur de la case occupée par le texte, selon sa longueur. Les
 * valeurs sont choisies pour qu'un sigle de 4 caractères tienne dans la plus
 * petite case (24 px) sans toucher le liseré.
 */
const FONT_RATIO = [0.5, 0.5, 0.38, 0.3, 0.24];

export function TeamSigil({
  label,
  color = "var(--blue-500)",
  size = 32,
}: TeamSigilProps) {
  const radius = size === 24 ? "4px" : size === 32 ? "6px" : "6px";
  // Le cadre est carré et de taille fixe : c'est le texte qui s'y adapte, pas
  // l'inverse. Une valeur plus longue que le maximum d'un sigle est tronquée
  // plutôt que rendue illisible.
  const text = label.toUpperCase().slice(0, TEAM_TAG_MAX_LENGTH);
  const ratio = FONT_RATIO[text.length] ?? FONT_RATIO[FONT_RATIO.length - 1];

  return (
    <div
      className={styles.root}
      style={
        {
          "--c": color,
          "--size": `${size}px`,
          "--radius": radius,
          "--font-size": `${Math.round(size * ratio)}px`,
        } as CSSProperties
      }
    >
      {text}
    </div>
  );
}
