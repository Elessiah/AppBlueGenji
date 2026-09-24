"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
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
  /**
   * Annonce aux technologies d'assistance qu'une opération est en cours. Vaut
   * `busy` par défaut ; une modale qui a d'autres envois (un téléversement)
   * sans pour autant bloquer la fermeture le précise ici.
   */
  ariaBusy?: boolean;
  children: ReactNode;
}

/**
 * Cadre commun des modales de gestion des pages publiques (chiffres et piliers
 * de la section 03, partenaires, bureau, bénévoles, contact du pied de page,
 * annonces de recrutement).
 *
 * Chaque section recopiait le sien, et deux d'entre elles le rendaient **dans**
 * la section : la racine d'`AboutSection` pose `position: relative; z-index: 1`,
 * un contexte d'empilement qui bornait le `z-index: 1000` du voile à la
 * section — les partenaires, peints après, passaient par-dessus selon la
 * position de défilement. D'où le **portail** vers `document.body`, et
 * `useDialogBehavior` pour le focus, Échap, le piège de tabulation et le
 * verrou du défilement (la pile partagée, et non un `overflow` sauvegardé à la
 * main, que la fermeture d'une autre modale aurait levé sous celle-ci). Le voile
 * ne ferme que sur un appui et un relâchement sur lui (`useBackdropDismiss`).
 *
 * Monté **seulement** quand la modale est ouverte, donc après un clic : jamais
 * rendu côté serveur, `document` est toujours là.
 */
export function LandingDialog({
  onClose,
  busy = false,
  className,
  labelledBy,
  label,
  ariaBusy = busy,
  children,
}: LandingDialogProps) {
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      {...backdrop}
    >
      <div
        ref={dialogRef}
        className={`${styles.panel} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        aria-busy={ariaBusy || undefined}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
