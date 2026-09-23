"use client";

import { ReactNode, useId, useState } from "react";
import { TeamDialog } from "./TeamDialog";
import styles from "../team.module.css";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  /**
   * Texte à recopier pour armer le bouton — réservé aux gestes sans retour
   * (dissoudre une équipe), comme la suppression d'un tournoi.
   */
  requireText?: string;
  onClose: () => void;
  /** Rend `true` si le geste a abouti — la modale ne se ferme qu'alors. */
  onConfirm: () => Promise<boolean>;
}

/**
 * Confirmation d'un geste destructeur de la fiche d'équipe.
 *
 * Remplace deux `window.confirm` et un clic nu : « Exclure » partait sans
 * question, et la dissolution d'une équipe — irréversible — tenait dans une
 * boîte système qu'un Entrée réflexe validait.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  pendingLabel,
  requireText,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const armed = requireText === undefined || typed.trim() === requireText.trim();

  const confirm = async () => {
    if (!armed || pending) return;
    setPending(true);
    const ok = await onConfirm();
    if (!ok) setPending(false);
  };

  return (
    <TeamDialog
      title={title}
      tone="danger"
      onClose={onClose}
      busy={pending}
      onSubmit={confirm}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={pending}>
            Annuler
          </button>
          <button type="submit" className="btn danger" disabled={!armed || pending}>
            {pending ? pendingLabel : confirmLabel}
          </button>
        </>
      }
    >
      {children}
      {requireText !== undefined ? (
        <div className={`field ${styles.confirmField}`}>
          <label htmlFor={inputId}>
            Recopie <strong>{requireText}</strong> pour confirmer
          </label>
          <input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      ) : null}
    </TeamDialog>
  );
}
