"use client";

import { useEffect, useState } from "react";
import styles from "../reports.module.css";

/** Délai pendant lequel le second clic confirme. */
const ARM_WINDOW_MS = 5000;

interface ArmedButtonProps {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Bouton d'un geste sans retour (supprimer définitivement un logo) : le premier
 * clic l'arme et change son libellé en question, le second — dans les cinq
 * secondes — l'exécute. Une modale de plus au milieu du panneau ralentirait le
 * traitement ; un clic unique rendrait l'erreur irréparable.
 *
 * Le changement de libellé est annoncé (`aria-live`) : un lecteur d'écran doit
 * savoir que le bouton attend une confirmation.
 */
export function ArmedButton({ label, confirmLabel, onConfirm, disabled, className }: ArmedButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={`${styles.actionButton} ${className ?? ""}`}
      disabled={disabled}
      aria-live="polite"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
