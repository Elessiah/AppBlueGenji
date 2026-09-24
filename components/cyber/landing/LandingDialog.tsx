"use client";

import { type ReactNode, useRef } from "react";
import { createPortal } from "react-dom";
import { isBackdropDismiss } from "@/lib/shared/backdrop-dismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import styles from "./LandingDialog.module.css";

interface LandingDialogProps {
  /** Fermeture demandée (Échap, clic sur le voile). */
  onClose: () => void;
  /** Opération en cours : ni Échap ni le voile ne referment la modale. */
  busy?: boolean;
  /** Habillage du panneau, propre à chaque section. */
  className: string;
  /** Identifiant du titre visible, ou à défaut un libellé. */
  labelledBy?: string;
  label?: string;
  children: ReactNode;
}

/**
 * Cadre commun des modales de gestion de la vitrine (chiffres et piliers de la
 * section 03, partenaires).
 *
 * Chaque section recopiait le sien, et deux d'entre elles le rendaient **dans**
 * la section : la racine d'`AboutSection` pose `position: relative; z-index: 1`,
 * un contexte d'empilement qui bornait le `z-index: 1000` du voile à la
 * section — les partenaires, peints après, passaient par-dessus selon la
 * position de défilement. D'où le **portail** vers `document.body`, et
 * `useDialogBehavior` pour le focus, Échap, le piège de tabulation et le
 * verrou du défilement (la pile partagée, et non un `overflow` sauvegardé à la
 * main, que la fermeture d'une autre modale aurait levé sous celle-ci).
 *
 * Monté **seulement** quand la modale est ouverte, donc après un clic : jamais
 * rendu côté serveur, `document` est toujours là.
 */
export function LandingDialog({ onClose, busy = false, className, labelledBy, label, children }: LandingDialogProps) {
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });
  const pressTarget = useRef<EventTarget | null>(null);

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onPointerDown={(e) => {
        pressTarget.current = e.target;
      }}
      onClick={(e) => {
        const dismiss = isBackdropDismiss(pressTarget.current, e.target, e.currentTarget);
        pressTarget.current = null;
        if (dismiss && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
