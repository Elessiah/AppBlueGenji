"use client";

import { FormEvent, ReactNode, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import styles from "./ConfirmActionDialog.module.css";

export interface ConfirmActionDialogProps {
  title: string;
  /** Ce que le geste entraîne — lu à l'ouverture, avant les boutons. */
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  onClose: () => void;
  /**
   * Exécute le geste. Rend `true` s'il a abouti : la modale ne se ferme qu'alors,
   * un refus la laisse ouverte pour qu'on puisse réessayer ou renoncer.
   */
  onConfirm: () => Promise<boolean>;
}

/**
 * Confirmation commune des gestes irréversibles de la fiche tournoi — abandon,
 * retrait d'une pénalité, lancement forcé d'un match.
 *
 * Ils passaient par `window.confirm`, quand leurs voisins (retour en arrière,
 * suppression, retrait d'un engagé) ont une modale : une boîte système qu'un
 * Entrée réflexe valide, dans le style du navigateur, que certains bloquent
 * après deux ouvertures. Mêmes règles que les autres dialogues de la page :
 * portail sur `document.body`, `useDialogBehavior`, voile fermé par
 * `useBackdropDismiss`, et **rien de verrouillé tant que le geste est en vol**
 * (le focus reste piégé, Échap et le voile ne ferment pas).
 *
 * Le focus s'ouvre sur « Annuler » (`data-autofocus`) : un Entrée réflexe ne
 * doit pas valider un geste qui ne se défait pas.
 */
export function ConfirmActionDialog({
  title,
  children,
  confirmLabel,
  pendingLabel,
  onClose,
  onConfirm,
}: ConfirmActionDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await onConfirm();
    if (ok) onClose();
    else setBusy(false);
  };

  if (!mounted) return null;

  return createPortal(
    <div role="presentation" className={styles.backdrop} {...backdrop}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={styles.dialog}
      >
        <h3 id={titleId} className={styles.title}>
          {title}
        </h3>
        <div id={bodyId} className={styles.body}>
          {children}
        </div>
        <form onSubmit={submit} className={styles.actions}>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy} data-autofocus>
            Annuler
          </button>
          <button type="submit" className="btn danger" disabled={busy}>
            {busy ? pendingLabel : confirmLabel}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
