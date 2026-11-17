"use client";

import { useEffect, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import styles from "../reports.module.css";

/** Délai pendant lequel le second clic confirme. */
const ARM_WINDOW_MS = 5000;

interface ArmedButtonProps {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** Ce geste attend sa réponse : refusé **et** annoncé occupé (`BusyButton`). */
  busy: boolean;
  /** Un autre geste attend : refusé sans annonce d'attente. */
  blocked?: boolean;
  className?: string;
  /** Nom du geste, pour rendre le focus après la relecture du dossier (`report-gestures.ts`). */
  "data-gesture"?: string;
}

/**
 * Bouton d'un geste sans retour (supprimer définitivement un logo) : le premier
 * clic l'arme et change son libellé en question, le second — dans les cinq
 * secondes — l'exécute. Une modale de plus au milieu du panneau ralentirait le
 * traitement ; un clic unique rendrait l'erreur irréparable.
 *
 * Le changement de libellé est annoncé (`aria-live`) : un lecteur d'écran doit
 * savoir que le bouton attend une confirmation. Pendant un envoi, il reste
 * focalisable (`BusyButton`, `BUSY_BUTTONS.md`) et ne s'arme pas.
 */
export function ArmedButton({
  label,
  confirmLabel,
  onConfirm,
  busy,
  blocked = false,
  className,
  "data-gesture": gesture,
}: Readonly<ArmedButtonProps>) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <BusyButton
      busy={busy}
      blocked={blocked}
      data-gesture={gesture}
      className={`${styles.actionButton} ${className ?? ""}`}
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
    </BusyButton>
  );
}
