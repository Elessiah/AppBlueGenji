"use client";

import { FormEvent, ReactNode, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import styles from "../team.module.css";

interface TeamDialogProps {
  title: ReactNode;
  /** Fermeture demandée (Échap, clic sur le voile, bouton d'annulation). */
  onClose: () => void;
  /** Opération en cours : ni Échap ni le voile ne referment la modale. */
  busy?: boolean;
  /** Présent : le panneau est un formulaire, Entrée le soumet. */
  onSubmit?: () => void;
  tone?: "default" | "danger";
  /** La modale contient une liste déroulante qui doit pouvoir déborder. */
  allowOverflow?: boolean;
  children: ReactNode;
  footer: ReactNode;
}

/**
 * Cadre commun des modales de la fiche d'équipe.
 *
 * Les trois modales de la page (rôles, transfert, attribution d'une fantôme)
 * recopiaient chacune leur cadre, et avaient toutes les trois les mêmes deux
 * défauts :
 *
 * - **rendues dans la page**, elles héritaient de son `<section class="fade-in">`
 *   — dont l'animation laisse un `transform` posé une fois terminée. Un élément
 *   transformé devient la référence de ses descendants en `position: fixed` :
 *   `inset: 0` couvrait donc toute la hauteur de la section (2 456 px mesurés
 *   sur une équipe d'un seul joueur) et non l'écran, si bien que la modale se
 *   centrait au milieu de la page, souvent sous le bord de l'écran, et que le
 *   voile laissait la barre de navigation claire. D'où le **portail** vers
 *   `document.body`, comme les dialogues de la fiche de tournoi ;
 * - **Échap ne fermait rien** : l'écouteur était posé sur le voile, et rien ne
 *   mettait le focus dans la modale à l'ouverture. `useDialogBehavior` porte le
 *   focus initial, le piège de tabulation, Échap et le retour du focus.
 */
export function TeamDialog({
  title,
  onClose,
  busy = false,
  onSubmit,
  tone = "default",
  allowOverflow = false,
  children,
  footer,
}: TeamDialogProps) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  // Ouverte **une fois montée** : au premier rendu le portail n'existe pas
  // encore, et le focus initial chercherait sa cible dans un conteneur absent.
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: busy });

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const content = (
    <>
      <h3 id={titleId} className={styles.dialogTitle}>
        {title}
      </h3>
      <div className={styles.dialogBody}>{children}</div>
      <div className={styles.dialogFooter}>{footer}</div>
    </>
  );

  const panelProps = {
    role: "dialog" as const,
    "aria-modal": true,
    "aria-labelledby": titleId,
    tabIndex: -1,
    className: styles.dialog,
    "data-tone": tone,
    "data-allow-overflow": allowOverflow ? "true" : undefined,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  };

  return createPortal(
    <div
      role="presentation"
      className={`${styles.backdrop} ${styles.page}`}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      {onSubmit ? (
        <form
          {...panelProps}
          ref={dialogRef as unknown as React.Ref<HTMLFormElement>}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!busy) onSubmit();
          }}
        >
          {content}
        </form>
      ) : (
        <div {...panelProps} ref={dialogRef}>
          {content}
        </div>
      )}
    </div>,
    document.body,
  );
}
